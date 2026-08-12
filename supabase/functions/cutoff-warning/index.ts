import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UAZAPI_BASE_URL = "https://ipazua.uazapi.com";
const BOT_DISCLAIMER = "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";
const DAYS_OVERDUE_THRESHOLD = 15;
const DAYS_UNTIL_CUTOFF = 5;

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getUazapiToken(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "uazapi_token")
    .maybeSingle();

  if (data?.value) return data.value;

  const envToken = Deno.env.get("UAZAPI_TOKEN");
  if (envToken) return envToken;

  throw new Error("Token WhatsApp não configurado.");
}

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (!digits.startsWith("55")) digits = "55" + digits;
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = `55${ddd}9${number}`;
  }
  return digits;
}

async function sendWhatsApp(phone: string, message: string) {
  const token = await getUazapiToken();
  const digits = formatPhone(phone);

  const response = await fetch(`${UAZAPI_BASE_URL}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number: digits, text: message }),
  });

  const text = await response.text();
  console.log("WhatsApp send result:", response.status, text.slice(0, 200));
  return response.ok;
}

async function sendSupportButton(phone: string) {
  try {
    const token = await getUazapiToken();
    const digits = formatPhone(phone);
    await fetch(`${UAZAPI_BASE_URL}/send/menu`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        number: digits,
        type: "button",
        text: "Precisa de Suporte?",
        choices: ["Falar com Suporte|https://wa.me/5585986801458?text=Preciso%20de%20Suporte"],
        footerText: "Escolha uma opção",
      }),
    });
  } catch (err) {
    console.error("Failed to send support button:", err);
  }
}

async function logNotification(supabase: any, params: {
  customer_id?: string;
  customer_name: string;
  phone?: string;
  type: string;
  message: string;
  status: "sent" | "failed";
  error_message?: string;
}) {
  try {
    await supabase.from("notification_logs").insert({
      customer_id: params.customer_id || null,
      customer_name: params.customer_name,
      phone: params.phone || null,
      type: params.type,
      message: params.message,
      status: params.status,
      error_message: params.error_message || null,
    });
  } catch (err) {
    console.error("Failed to log notification:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate the date that is exactly DAYS_OVERDUE_THRESHOLD days ago
    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() - DAYS_OVERDUE_THRESHOLD);
    const thresholdStr = `${thresholdDate.getFullYear()}-${String(thresholdDate.getMonth() + 1).padStart(2, "0")}-${String(thresholdDate.getDate()).padStart(2, "0")}`;

    console.log(`Checking invoices due on or before ${thresholdStr} (${DAYS_OVERDUE_THRESHOLD}+ days overdue)`);

    // Get overdue invoices that are exactly 15 days overdue (vencimento = thresholdDate)
    // to avoid sending duplicate notifications
    const { data: overdueInvoices } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .eq("vencimento", thresholdStr)
      .in("status", ["pending", "overdue"]);

    const invoices = overdueInvoices || [];

    if (invoices.length === 0) {
      console.log("No invoices exactly 15 days overdue today.");
      return new Response(JSON.stringify({
        message: `Nenhuma fatura com exatamente ${DAYS_OVERDUE_THRESHOLD} dias de atraso hoje.`,
        sent: 0,
        failed: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formatCurrency = (v: number) =>
      (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const formatDate = (d: string) => {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    };

    let sent = 0;
    let failed = 0;
    const skipped: string[] = [];

    for (const inv of invoices) {
      const customer = (inv as any).customers;
      if (!customer?.telefone) {
        skipped.push(customer?.nome || inv.customer_id);
        continue;
      }

      const nome = customer.nome.split(" ")[0];
      const invoiceUrl = `https://myllenet.lovable.app/fatura/${inv.id}`;
      const message = `Olá ${nome}! 🌐

⚠️ *AVISO IMPORTANTE da Mororo.Tech*

Sua fatura está com *${DAYS_OVERDUE_THRESHOLD} dias de atraso*:

📋 ${inv.descricao}
💰 Valor: ${formatCurrency(inv.valor_centavos)}
📅 Vencimento: ${formatDate(inv.vencimento)}

🔗 *Link da Fatura:* ${invoiceUrl}

🚨 *Seu sinal será cortado em ${DAYS_UNTIL_CUTOFF} dias* caso o pagamento não seja regularizado.

Regularize agora para evitar a suspensão do serviço!

_Equipe Mororo.Tech_`;

      try {
        const fullMessage = message + BOT_DISCLAIMER;
        const ok = await sendWhatsApp(customer.telefone, fullMessage);
        if (ok) {
          await sendSupportButton(customer.telefone);
          sent++;
          await logNotification(supabase, {
            customer_id: inv.customer_id,
            customer_name: customer.nome,
            phone: customer.telefone,
            type: "aviso_corte",
            message: fullMessage,
            status: "sent",
          });
        } else {
          failed++;
          await logNotification(supabase, {
            customer_id: inv.customer_id,
            customer_name: customer.nome,
            phone: customer.telefone,
            type: "aviso_corte",
            message,
            status: "failed",
            error_message: "WhatsApp API returned non-ok status",
          });
        }
      } catch (err) {
        console.error(`Failed to send cutoff warning to ${customer.nome}:`, err);
        failed++;
        await logNotification(supabase, {
          customer_id: inv.customer_id,
          customer_name: customer.nome,
          phone: customer.telefone,
          type: "aviso_corte",
          message,
          status: "failed",
          error_message: err.message,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const result = {
      invoices_15_days_overdue: invoices.length,
      sent,
      failed,
      skipped_no_phone: skipped.length,
    };
    console.log("Cutoff warning result:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Cutoff warning error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
