import { createClient } from "npm:@supabase/supabase-js@2";

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
      .select("id, nome")
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
    if (webhook) {
      const p = fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("AGENTE_TOKEN") ?? ""}`,
        },
        body: JSON.stringify({ diagnostico_id: inserted.id, cliente_id: cliente.id, ip_publico: ip || null }),
      }).catch((e) => console.error("webhook error", e));
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(p);
    }

    return json({ ok: true, protocolo: inserted.id.slice(0, 8).toUpperCase() });
  } catch (e) {
    console.error("diagnostico error", e);
    return json({ erro: "Erro interno" }, 500);
  }
});
