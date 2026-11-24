// cutoff-warning — avisa o CLIENTE, N dias antes, que o sinal será bloqueado
//
// Usa a mesma regra e a mesma data do bloqueio automático:
//   - public.clientes_a_bloquear(data) = quem será bloqueado na execução daquele dia
//   - datas no fuso America/Fortaleza (public.hoje_local())
//   - N = settings.aviso_corte_dias_antes (padrão 5)
// Cada cliente recebe o aviso uma vez: no dia em que passa a constar na lista de daqui a N dias.
import { createClient } from "npm:@supabase/supabase-js@2";
import { waSendText, waSendSupportButton } from "../_shared/whatsapp.ts";
import { exigir } from "../_shared/auth.ts";
import { carregarConfig } from "../_shared/config.ts";
let PROVEDOR = "Mororo.Tech";
let PAINEL = "https://myllenet.mororo.tech";
let TELEFONE_FMT = "";
let SLOGAN = "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
let BOT_DISCLAIMER = "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const brl = (c: number) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const negado = await exigir(req, "interno");
  if (negado) return negado;
  { const __c = await carregarConfig(); PROVEDOR = __c.provedor; PAINEL = __c.painel; TELEFONE_FMT = __c.telefoneFmt; SLOGAN = __c.slogan; BOT_DISCLAIMER = __c.rodape; }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const simular = body?.simular === true; // só lista, não envia

    const { data: hoje, error: eHoje } = await supabase.rpc("hoje_local");
    if (eHoje) throw eHoje;
    const { data: cfg } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["aviso_corte_dias_antes", "blocking_days"]);
    const s: Record<string, string> = {};
    for (const r of cfg || []) s[r.key] = r.value ?? "";
    const diasAntes = Math.max(1, parseInt(s.aviso_corte_dias_antes || "5", 10) || 5);
    const diasBloqueio = Math.max(1, parseInt(s.blocking_days || "15", 10) || 15);

    const dataCorte = somaDias(String(hoje), diasAntes);
    const lista = async (d: string) => {
      const { data, error } = await supabase.rpc("clientes_a_bloquear", { p_data_execucao: d });
      if (error) throw error;
      return (data || []) as any[];
    };
    // entram hoje na lista de "bloqueio daqui a N dias" (não estavam na de N-1 dias)
    const ontem = new Set((await lista(somaDias(dataCorte, -1))).map((c) => c.customer_id));
    const alvos = (await lista(dataCorte)).filter((c) => !ontem.has(c.customer_id));

    let sent = 0;
    let failed = 0;
    const skipped: string[] = [];
    const previa: any[] = [];

    for (const c of alvos) {
      // faturas que vão causar o bloqueio (vencimento <= data do corte - dias de bloqueio)
      const limite = somaDias(dataCorte, -diasBloqueio);
      const { data: faturas } = await supabase
        .from("invoices")
        .select("id, descricao, valor_centavos, vencimento")
        .eq("customer_id", c.customer_id)
        .in("status", ["pending", "overdue"])
        .lte("vencimento", limite)
        .order("vencimento", { ascending: true });
      const fs = faturas || [];
      previa.push({ cliente: c.nome, telefone: c.telefone, corte: dataCorte, faturas: fs.length, total: c.valor_centavos });
      if (simular) continue;
      if (!c.telefone) { skipped.push(c.nome); continue; }

      const nome = String(c.nome || "").split(" ")[0];
      const linhas = fs.map((f: any) =>
        `📋 ${f.descricao} — ${brl(f.valor_centavos)} (venc. ${dataBR(f.vencimento)})\n🔗 ${PAINEL}/fatura/${f.id}`
      );
      const message = `Olá ${nome}! 🌐

⚠️ *AVISO IMPORTANTE da ${PROVEDOR}*

${fs.length > 1 ? "Você tem faturas em aberto" : "Sua fatura está em aberto"}:

${linhas.join("\n\n")}

💰 Total: ${brl(c.valor_centavos)}

🚨 *Seu sinal será bloqueado em ${dataBR(dataCorte)}* caso o pagamento não seja regularizado até lá.

Pague pelo link acima para evitar a suspensão do serviço.

_Equipe ${PROVEDOR}_${BOT_DISCLAIMER}`;

      let erro: string | null = null;
      try {
        await waSendText(c.telefone, message);
        await waSendSupportButton(c.telefone).catch(() => {});
        sent++;
      } catch (e) {
        erro = (e as Error).message;
        failed++;
      }
      await supabase.from("notification_logs").insert({
        customer_id: c.customer_id,
        customer_name: c.nome,
        phone: c.telefone,
        type: "aviso_corte",
        message,
        status: erro ? "failed" : "sent",
        error_message: erro,
      });
      await new Promise((r) => setTimeout(r, 1500));
    }

    const result = {
      hoje,
      data_corte: dataCorte,
      dias_antes: diasAntes,
      clientes: alvos.length,
      sent,
      failed,
      skipped_no_phone: skipped.length,
      ...(simular ? { previa } : {}),
    };
    console.log("Cutoff warning result:", result);
    return json(result);
  } catch (err) {
    console.error("Cutoff warning error:", err);
    return json({ error: (err as Error).message || "Erro interno" }, 500);
  }
});
