import { createClient } from "npm:@supabase/supabase-js@2";
import { conectarMikrotik, duracaoMs, taxaMbps } from "../_shared/mikrotik.ts";
import { carregarConfig } from "../_shared/config.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function ipv4ToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.trim().split("/");
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base ?? "");
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

function getIp(req: Request): string {
  let ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPhone(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (!d.startsWith("55")) d = "55" + d;
  if (d.length === 12) d = `55${d.substring(2, 4)}9${d.substring(4)}`;
  return d;
}

// deno-lint-ignore no-explicit-any
function planoMbps(plano: any): number | null {
  for (const s of [plano?.nome_servidor, plano?.nome]) {
    const m = String(s ?? "").match(/(\d+(?:[.,]\d+)?)\s*(m|g)/i);
    if (m) return parseFloat(m[1].replace(",", ".")) * (m[2].toLowerCase() === "g" ? 1000 : 1);
  }
  return null;
}

/**
 * Visão do provedor, direto pela API REST do MikroTik (substitui o agente local):
 * sessão PPPoE, ping do concentrador até o cliente, tráfego da sessão, limite da fila,
 * quedas nas últimas 24 h / 7 dias. Grava um diagnóstico origem "provedor" ligado ao do cliente.
 */
// deno-lint-ignore no-explicit-any
async function analisarProvedor(supabase: any, cliente: any, diagId: string, rowCliente: any) {
  const login = String(cliente.usuario_pppoe ?? "").trim();
  const plano = planoMbps(cliente.plans);
  // deno-lint-ignore no-explicit-any
  const dados: any = { fonte: "api_rest", diagnostico_origem_id: diagId, pppoe: {}, ping: {}, plano_mbps: plano };

  if (!login) {
    dados.erro = "Cliente sem usuário PPPoE cadastrado";
  } else {
    try {
      const mk = await conectarMikrotik(supabase);
      const ativos = await mk.get(`/ppp/active?name=${encodeURIComponent(login)}`, 6000);
      const s = Array.isArray(ativos) ? ativos[0] : null;
      dados.pppoe = s
        ? { online: true, ip: s.address ?? null, uptime: s.uptime ?? null, mac: s["caller-id"] ?? null, login }
        : { online: false, login };

      if (s?.address) {
        const iface = `<pppoe-${login}>`;
        const [ping, trafego, fila] = await Promise.allSettled([
          mk.post("/ping", { address: s.address, count: "10", interval: "0.2" }, 15000),
          mk.post("/interface/monitor-traffic", { interface: iface, once: "" }, 8000),
          mk.get(`/queue/simple?name=${encodeURIComponent(iface)}`, 6000),
        ]);
        if (ping.status === "fulfilled" && Array.isArray(ping.value) && ping.value.length) {
          const u = ping.value[ping.value.length - 1];
          const perda = Number(String(u["packet-loss"] ?? "").replace("%", ""));
          dados.ping = {
            enviados: Number(u.sent ?? ping.value.length),
            recebidos: Number(u.received ?? 0),
            perda_pct: Number.isFinite(perda) ? perda : null,
            media_ms: duracaoMs(u["avg-rtt"]),
            max_ms: duracaoMs(u["max-rtt"]),
          };
        } else if (ping.status === "rejected") dados.ping = { erro: String(ping.reason?.message ?? ping.reason) };
        if (trafego.status === "fulfilled") {
          const t = Array.isArray(trafego.value) ? trafego.value[0] : trafego.value;
          // visto do concentrador: tx = o que desce para o cliente, rx = o que ele envia
          dados.trafego = {
            download_mbps: t ? Number(t["tx-bits-per-second"] ?? 0) / 1e6 : null,
            upload_mbps: t ? Number(t["rx-bits-per-second"] ?? 0) / 1e6 : null,
          };
        }
        if (fila.status === "fulfilled" && Array.isArray(fila.value) && fila.value[0]) {
          const [up, down] = String(fila.value[0]["max-limit"] ?? "").split("/");
          dados.fila = { max_limit: fila.value[0]["max-limit"] ?? null, upload_mbps: taxaMbps(up), download_mbps: taxaMbps(down) };
        }
      }
    } catch (e) {
      dados.erro = (e as Error).message;
    }
  }

  // quedas registradas pelo mikrotik-sync-logs
  if (cliente.id) {
    const agora = Date.now();
    const conta = async (horas: number) => {
      const { count } = await supabase
        .from("pppoe_logs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", cliente.id)
        .eq("event_type", "disconnected")
        .gte("logged_at", new Date(agora - horas * 3600_000).toISOString());
      return count ?? 0;
    };
    const { data: ult } = await supabase
      .from("pppoe_logs")
      .select("logged_at")
      .eq("customer_id", cliente.id)
      .eq("event_type", "disconnected")
      .order("logged_at", { ascending: false })
      .limit(1);
    dados.quedas = { h24: await conta(24), d7: await conta(24 * 7), ultima: ult?.[0]?.logged_at ?? null };
  }

  // veredito e leitura para o atendimento
  const online = dados.pppoe?.online;
  const perda = Number(dados.ping?.perda_pct ?? 0);
  const media = Number(dados.ping?.media_ms ?? 0);
  const q24 = Number(dados.quedas?.h24 ?? 0);
  const limite = dados.fila?.download_mbps ?? plano;
  const resumo: string[] = [];
  if (dados.erro && online === undefined) resumo.push(`Não foi possível consultar o MikroTik: ${dados.erro}`);
  if (online === false) resumo.push("Cliente sem sessão PPPoE ativa no momento do teste");
  if (online && perda >= 1) resumo.push(`Perda de ${perda.toFixed(0)}% entre o concentrador e o cliente: verificar enlace, ONU ou rádio`);
  if (online && perda < 1 && media > 50) resumo.push(`Latência alta até o cliente (${media.toFixed(0)} ms): verificar enlace`);
  if (q24 >= 3) resumo.push(`${q24} quedas nas últimas 24 h (${dados.quedas?.d7 ?? 0} em 7 dias): instabilidade`);
  if (dados.trafego?.download_mbps != null && limite && dados.trafego.download_mbps >= limite * 0.7)
    resumo.push(`Banda ocupada por outros aparelhos no momento (${dados.trafego.download_mbps.toFixed(1)} de ${limite} Mbps)`);
  if (dados.fila?.download_mbps && plano && Math.abs(dados.fila.download_mbps - plano) > plano * 0.1)
    resumo.push(`Limite no roteador (${dados.fila.download_mbps} Mbps) diferente do plano (${plano} Mbps)`);
  const provOk = online === true && perda < 1 && media <= 50 && q24 < 3;
  if (provOk && ["falha", "alerta"].includes(rowCliente.veredito))
    resumo.push("Rede do provedor ok até o cliente; problema provável no roteador, Wi-Fi ou aparelho da casa");
  if (limite && typeof rowCliente.download_mbps === "number") {
    const pct = (rowCliente.download_mbps / limite) * 100;
    dados.percentual_plano = Math.round(pct);
    if (pct < 50 && provOk) resumo.push(`Velocidade medida: ${pct.toFixed(0)}% do plano (${rowCliente.download_mbps.toFixed(1)} de ${limite} Mbps)`);
  }
  dados.resumo = resumo;
  const veredito = online === false || perda >= 20 ? "falha"
    : online === undefined ? null
    : perda > 0 || media > 50 || q24 >= 3 ? "alerta" : "ok";

  const { data: ins } = await supabase
    .from("diagnosticos")
    .insert({
      cliente_id: cliente.id,
      origem: "provedor",
      dados,
      latencia_ms: dados.ping?.media_ms ?? null,
      perda_pct: dados.ping?.perda_pct ?? null,
      veredito,
      ip_publico: dados.pppoe?.ip ?? null,
      na_rede_provedor: online === true ? true : online === false ? false : null,
    })
    .select("id")
    .single();
  return { id: ins?.id ?? null, veredito, dados };
}

// deno-lint-ignore no-explicit-any
async function notifyAdmin(supabase: any, nome: string, id: string, row: any, ip: string, naRede: boolean, prov?: any) {
  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["admin_whatsapp", "whatsapp_provider", "uazapi_token", "uazapi_base_url", "evolution_base_url", "evolution_api_key", "evolution_instance"]);
  const s: Record<string, string> = {};
  for (const r of rows ?? []) s[r.key] = r.value ?? "";
  if (!s.admin_whatsapp) return;

  const vered: Record<string, string> = { ok: "✅ Normal", alerta: "⚠️ Com pontos de atenção", falha: "❌ Problema encontrado" };
  const f = (v: unknown, u: string) => (typeof v === "number" ? `${v.toFixed(1)} ${u}` : "—");
  const linhas = [
    `🔎 *Novo diagnóstico de conexão*`,
    `Cliente: *${nome}*`,
    `Protocolo: ${id.slice(0, 8).toUpperCase()}`,
    `Origem: ${row.origem === "windows" ? "Windows (completo)" : "Navegador"}`,
  ];
  if (row.origem === "navegador") {
    linhas.push(
      `Resultado: ${vered[row.veredito] ?? "—"}`,
      `Download: ${f(row.download_mbps, "Mbps")}`,
      `Upload: ${f(row.upload_mbps, "Mbps")}`,
      `Latência: ${f(row.latencia_ms, "ms")} | Jitter: ${f(row.jitter_ms, "ms")} | Perda: ${f(row.perda_pct, "%")}`,
    );
    const tipo = row.dados?.conexao?.tipo;
    if (tipo) linhas.push(`Conexão do aparelho: ${tipo === "cellular" ? "dados móveis" : tipo}`);
  }
  linhas.push(`IP: ${ip || "—"} | Na rede do provedor: ${naRede ? "sim" : "não"}`);
  if (prov?.dados) {
    const pd = prov.dados;
    linhas.push("", `📡 *Visão do provedor*: ${vered[prov.veredito] ?? "—"}`);
    linhas.push(`PPPoE: ${pd.pppoe?.online === false ? "offline" : pd.pppoe?.online ? `online há ${pd.pppoe.uptime ?? "?"}` : "—"}`);
    if (pd.ping?.media_ms != null) linhas.push(`Ping até o cliente: ${Number(pd.ping.media_ms).toFixed(0)} ms, perda ${pd.ping.perda_pct ?? "?"}%`);
    if (pd.quedas) linhas.push(`Quedas: ${pd.quedas.h24} em 24 h, ${pd.quedas.d7} em 7 dias`);
    for (const r of pd.resumo ?? []) linhas.push(`• ${r}`);
  }
  linhas.push("", `Abrir: ${(await carregarConfig()).painel}/diagnosticos?id=${id}`);
  const text = linhas.join("\n");

  let url: string, headers: Record<string, string>;
  if (s.whatsapp_provider === "evolution") {
    if (!s.evolution_base_url || !s.evolution_api_key || !s.evolution_instance) return;
    url = `${s.evolution_base_url.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(s.evolution_instance)}`;
    headers = { apikey: s.evolution_api_key };
  } else {
    const token = s.uazapi_token || Deno.env.get("UAZAPI_TOKEN") || "";
    if (!token) return;
    url = `${(s.uazapi_base_url || "https://ipazua.uazapi.com").replace(/\/+$/, "")}/send/text`;
    headers = { token };
  }
  const numeros = [...new Set(s.admin_whatsapp.split(/[,;\s]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 10))];
  for (const fone of numeros) {
    const number = formatPhone(fone);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ number, text }),
    });
    const body = await res.text();
    await supabase.from("notification_logs").insert({
      customer_name: "Administrador",
      phone: number,
      type: "diagnostico_admin",
      message: text,
      status: res.ok ? "sent" : "error",
      error_message: res.ok ? null : `[${res.status}] ${body.slice(0, 400)}`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = new URL(req.url).searchParams.get("c") ?? "";
    if (!UUID_RE.test(token)) return json({ erro: "Link inválido ou expirado" }, 404);

    const { data: cliente } = await supabase
      .from("customers")
      .select("id, nome, usuario_pppoe, plan_id, plans(nome, nome_servidor)")
      .eq("diagnostico_token", token)
      .maybeSingle();
    if (!cliente) return json({ erro: "Link inválido ou expirado" }, 404);

    const { data: cfg } = await supabase
      .from("config_diagnostico")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const ip = getIp(req);
    const faixas: string[] = cfg?.faixas_ip ?? [];
    let naRede = !!ip && faixas.some((c) => ipInCidr(ip, c));
    if (!naRede && ip) {
      // Compara com os IPs das sessões PPPoE ativas no MikroTik (últimos 15 min)
      const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: sess } = await supabase
        .from("pppoe_logs")
        .select("id")
        .eq("ip_address", ip)
        .gte("logged_at", desde)
        .limit(1);
      if (sess && sess.length > 0) naRede = true;
    }

    if (req.method === "GET") {
      return json({
        ip,
        na_rede_provedor: naRede,
        cliente_primeiro_nome: (cliente.nome ?? "").trim().split(/\s+/)[0] ?? "",
        plano_mbps: planoMbps((cliente as any).plans),
        provedor: await carregarConfig().then((c) => ({ nome: c.provedor, telefone: c.telefone, telefone_fmt: c.telefoneFmt })).catch(() => null),
        config: {
          speedtest_url: cfg?.speedtest_url ?? null,
          dns_curinga: cfg?.dns_curinga ?? null,
          sites: cfg?.sites ?? [],
          duracao_ms: cfg?.duracao_ms ?? 8000,
          fluxos: cfg?.fluxos ?? 4,
        },
      });
    }

    // POST — rate limit
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from("diagnosticos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", cliente.id)
      .gte("criado_em", since);
    if ((count ?? 0) >= 10) return json({ erro: "Limite de diagnósticos por hora atingido" }, 429);

    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    const raw = new Uint8Array(await req.arrayBuffer());
    const text = new TextDecoder().decode(raw);

    let row: Record<string, unknown>;
    if (ct.includes("application/json")) {
      if (raw.byteLength > 200 * 1024) return json({ erro: "Relatório muito grande" }, 413);
      let dados: any;
      try {
        dados = JSON.parse(text);
      } catch {
        return json({ erro: "JSON inválido" }, 400);
      }
      if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
        return json({ erro: "JSON inválido" }, 400);
      }
      const v = dados?.resumo?.veredito;
      row = {
        origem: "navegador",
        dados,
        veredito: ["ok", "alerta", "falha"].includes(v) ? v : null,
        download_mbps: num(dados?.velocidade?.download_mbps),
        upload_mbps: num(dados?.velocidade?.upload_mbps),
        latencia_ms: num(dados?.latencia?.ms),
        jitter_ms: num(dados?.latencia?.jitter_ms),
        perda_pct: num(dados?.latencia?.perda_pct),
      };
    } else {
      if (raw.byteLength > 300 * 1024) return json({ erro: "Relatório muito grande" }, 413);
      row = { origem: "windows", dados: { texto: text } };
    }

    const { data: inserted, error } = await supabase
      .from("diagnosticos")
      .insert({
        ...row,
        cliente_id: cliente.id,
        ip_publico: ip || null,
        na_rede_provedor: naRede,
        user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("insert error", error);
      return json({ erro: "Não foi possível salvar o diagnóstico" }, 500);
    }

    const webhook = Deno.env.get("AGENTE_WEBHOOK_URL");
    let tarefa: Promise<unknown>;
    if (webhook) {
      // agente local (legado): ele mesmo grava a visão do provedor
      tarefa = fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("AGENTE_TOKEN") ?? ""}` },
        body: JSON.stringify({ diagnostico_id: inserted.id, cliente_id: cliente.id, ip_publico: ip || null }),
      }).then(() => notifyAdmin(supabase, cliente.nome, inserted.id, row, ip, naRede));
    } else {
      tarefa = analisarProvedor(supabase, cliente, inserted.id, row)
        .catch((e) => { console.error("analise provedor", e); return null; })
        .then((prov) => notifyAdmin(supabase, cliente.nome, inserted.id, row, ip, naRede, prov));
    }
    const aviso = tarefa.catch((e) => console.error("diagnostico background", e));
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(aviso);

    return json({ ok: true, protocolo: inserted.id.slice(0, 8).toUpperCase() });
  } catch (e) {
    console.error("diagnostico error", e);
    return json({ erro: "Erro interno" }, 500);
  }
});
