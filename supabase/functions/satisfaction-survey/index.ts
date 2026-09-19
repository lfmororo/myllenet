import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getWhatsAppConfig, waSendText } from "../_shared/whatsapp.ts";

const BOT_DISCLAIMER =
  "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";

const DEFAULT_SURVEY_URL = "https://app.mororo.tech/satisfacao";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function surveyMessage(nome: string | null, url: string) {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  return (
    `${saudacao} 👋\n\n` +
    `Somos da *Mororo.Tech* e queremos garantir que sua internet esteja sempre à altura do que você espera.\n\n` +
    `⭐ *Avalie nosso atendimento* e, se precisar, registre uma *solicitação* ou *reclamação*. ` +
    `Leva menos de 1 minuto e sua resposta nos ajuda a melhorar o serviço prestado a você.\n\n` +
    `👉 ${url}\n\n` +
    `Agradecemos a sua confiança! 🚀`
  );
}

function isInternalCron(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  return !!secret && !!provided && provided === secret;
}

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader) throw new Error("Não autenticado");
  const supabase = admin();
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) throw new Error("Não autenticado");
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) throw new Error("Acesso restrito a administradores");
}

async function getSurveyUrl(supabase: any, override?: string) {
  if (override && /^https?:\/\//.test(override)) return override;
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "satisfaction_url")
    .maybeSingle();
  return data?.value || DEFAULT_SURVEY_URL;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!isInternalCron(req)) {
      await verifyAdmin(req.headers.get("Authorization"));
    }

    const body = await req.json().catch(() => ({}));
    const supabase = admin();
    const url = await getSurveyUrl(supabase, body?.url);
    const cfg = await getWhatsAppConfig();

    let query = supabase
      .from("customers")
      .select("id, nome, telefone")
      .eq("ativo", true)
      .not("telefone", "is", null);

    if (body?.customer_id) query = supabase
      .from("customers")
      .select("id, nome, telefone")
      .eq("id", body.customer_id);

    const { data: customers, error } = await query;
    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const customer of customers || []) {
      if (!customer.telefone) {
        failed++;
        continue;
      }
      const message = surveyMessage(customer.nome, url) + BOT_DISCLAIMER;
      let ok = true;
      let errMsg: string | null = null;
      try {
        await waSendText(customer.telefone, message, cfg);
      } catch (e) {
        ok = false;
        errMsg = (e as Error).message?.slice(0, 500) || "Erro ao enviar WhatsApp";
      }
      ok ? sent++ : failed++;

      await supabase.from("notification_logs").insert({
        customer_id: customer.id,
        customer_name: customer.nome,
        phone: customer.telefone,
        type: "pesquisa_satisfacao",
        message,
        status: ok ? "sent" : "failed",
        error_message: errMsg,
      });

      await new Promise((r) => setTimeout(r, 1200));
    }

    return json({ success: true, sent, failed, total: (customers || []).length });
  } catch (e) {
    const msg = (e as Error).message || "Erro inesperado";
    const status = msg.includes("autentic") || msg.includes("administrador") ? 401 : 500;
    return json({ error: msg }, status);
  }
});
