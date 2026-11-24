// aviso-bloqueio-admin — avisa os administradores, pela Evolution API, sobre bloqueios
//
//   { "modo": "previa" }                      → cron diário (09:00 Brasília): clientes que
//                                               serão bloqueados hoje às 23h e amanhã às 23h
//   { "modo": "bloqueado", "customer_id", "new_status", "alert_id" }
//                                             → disparado na hora pelo trigger em
//                                               block_alerts_sent (bloqueio automático ou manual)
//
// Administradores: chave admin_whatsapp em settings (vários números separados por vírgula).
// Só aceita chamadas com a service role key (cron/trigger).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getWhatsAppConfig, waSendText } from "../_shared/whatsapp.ts";

const ADMIN_PADRAO = "85986801458";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const brl = (c: number) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const isoDia = (d: Date) => d.toISOString().slice(0, 10);

async function administradores(supabase: any): Promise<string[]> {
  const { data } = await supabase.from("settings").select("value").eq("key", "admin_whatsapp").maybeSingle();
  const lista = String(data?.value || "")
    .split(/[,;\s\n]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 10);
  return lista.length ? [...new Set(lista)] : [ADMIN_PADRAO];
}

async function configEvolution() {
  const cfg = await getWhatsAppConfig();
  // avisos internos sempre pela Evolution API, se ela estiver configurada
  if (cfg.evolutionBaseUrl && cfg.evolutionApiKey && cfg.evolutionInstance) cfg.provider = "evolution";
  return cfg;
}

async function enviar(supabase: any, tipo: string, texto: string, customer?: { id?: string; nome?: string }) {
  const cfg = await configEvolution();
  const fones = await administradores(supabase);
  let ok = 0;
  for (const fone of fones) {
    let erro: string | null = null;
    try {
      await waSendText(fone, texto, cfg);
      ok++;
    } catch (e) {
      erro = (e as Error).message;
      console.error(`aviso ${tipo} para ${fone} falhou:`, erro);
    }
    await supabase.from("notification_logs").insert({
      customer_id: customer?.id || null,
      customer_name: customer?.nome || "Administradores",
      phone: fone,
      type: tipo,
      message: texto,
      status: erro ? "failed" : "sent",
      error_message: erro,
    });
  }
  return { enviados: ok, administradores: fones.length };
}

async function previa(supabase: any) {
  // O bloqueio automático roda às 23:00 (Brasília) e usa a data local (public.hoje_local()).
  const { data: hoje, error: eHoje } = await supabase.rpc("hoje_local");
  if (eHoje) throw eHoje;
  const amanhaIso = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

  const lista = async (d: string) => {
    const { data, error } = await supabase.rpc("clientes_a_bloquear", { p_data_execucao: d });
    if (error) throw error;
    return (data || []) as any[];
  };
  const hojeLista = await lista(String(hoje));
  const idsHoje = new Set(hojeLista.map((c) => c.customer_id));
  const amanha = (await lista(amanhaIso)).filter((c) => !idsHoje.has(c.customer_id));

  if (!hojeLista.length && !amanha.length) return { hoje: 0, amanha: 0, enviados: 0 };

  const linha = (c: any) =>
    `• *${c.nome}*${c.usuario_pppoe ? ` (${c.usuario_pppoe})` : ""}\n` +
    `  📞 ${c.telefone || "sem telefone"} | ${c.faturas} fatura(s) | ${brl(c.valor_centavos)} | venc. ${dataBR(c.vencimento_mais_antigo)} (${c.dias_atraso} dias)`;

  const partes = [`⏰ *AVISO DE BLOQUEIO PROGRAMADO*`];
  if (amanha.length) partes.push(`\n*Amanhã às 23h* — ${amanha.length} cliente(s):\n${amanha.map(linha).join("\n")}`);
  if (hojeLista.length) partes.push(`\n*Hoje às 23h* — ${hojeLista.length} cliente(s):\n${hojeLista.map(linha).join("\n")}`);
  partes.push(`\nO bloqueio só não acontece se as faturas forem pagas ou se o cliente for marcado como inativo antes do horário.`);

  const r = await enviar(supabase, "admin_previa_bloqueio", partes.join("\n"));
  return { hoje: hojeLista.length, amanha: amanha.length, ...r };
}

async function bloqueado(supabase: any, body: any) {
  const status = String(body.new_status || "");
  if (!["blocked", "deactivated"].includes(status)) return { ignorado: status };

  const { data: c } = await supabase
    .from("customers")
    .select("id, nome, telefone, usuario_pppoe")
    .eq("id", body.customer_id)
    .maybeSingle();
  if (!c) return { ignorado: "cliente não encontrado" };

  const { data: hist } = await supabase
    .from("block_history")
    .select("reason, changed_by, created_at")
    .eq("customer_id", c.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let quem = "automático";
  if (hist?.changed_by) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("user_id", hist.changed_by).maybeSingle();
    quem = p?.full_name || "usuário do sistema";
  }

  const { data: abertas } = await supabase
    .from("invoices")
    .select("valor_centavos, vencimento")
    .eq("customer_id", c.id)
    .in("status", ["pending", "overdue"]);
  const total = (abertas || []).reduce((s: number, i: any) => s + Number(i.valor_centavos || 0), 0);

  const titulo = status === "blocked" ? "🚫 *CLIENTE BLOQUEADO*" : "🛑 *CLIENTE DESATIVADO*";
  const texto = [
    titulo,
    ``,
    `Cliente: *${c.nome}*${c.usuario_pppoe ? ` (${c.usuario_pppoe})` : ""}`,
    `Telefone: ${c.telefone || "não informado"}`,
    `Faturas em aberto: ${(abertas || []).length} (${brl(total)})`,
    `Motivo: ${hist?.reason || (status === "blocked" ? "pendência financeira" : "plano desativado")}`,
    `Por: ${quem}`,
    `Quando: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}`,
  ].join("\n");

  const r = await enviar(supabase, status === "blocked" ? "admin_cliente_bloqueado" : "admin_cliente_desativado", texto, c);
  if (body.alert_id) await supabase.from("block_alerts_sent").update({ admin_notified: true }).eq("id", body.alert_id);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!service || token !== service) return json({ error: "não autorizado" }, 401);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, service);
    const body = await req.json().catch(() => ({}));
    if (body.modo === "previa") return json({ ok: true, ...(await previa(supabase)) });
    if (body.modo === "bloqueado") return json({ ok: true, ...(await bloqueado(supabase, body)) });
    return json({ error: "modo inválido (previa | bloqueado)" }, 400);
  } catch (e) {
    console.error("aviso-bloqueio-admin", e);
    return json({ error: (e as Error).message }, 500);
  }
});
