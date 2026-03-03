import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UAZAPI_BASE_URL = "https://ipazua.uazapi.com";

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
    headers: { "Content-Type": "application/json", "token": token },
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
      headers: { "Content-Type": "application/json", "token": token },
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

    const reminderDate = new Date(today);
    reminderDate.setDate(reminderDate.getDate() + 3);
    const reminderStr = `${reminderDate.getFullYear()}-${String(reminderDate.getMonth() + 1).padStart(2, "0")}-${String(reminderDate.getDate()).padStart(2, "0")}`;

    console.log(`Checking invoices due on ${reminderStr} (3 days from now)`);

    const { data: dueSoon } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .eq("vencimento", reminderStr)
      .eq("status", "pending");

    const invoices = dueSoon || [];

    if (invoices.length === 0) {
      console.log("No invoices due in 3 days.");
      return new Response(JSON.stringify({ message: "Nenhuma fatura vencendo em 3 dias.", sent: 0, failed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formatCurrency = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
      const message = `Olá ${nome}! 🌐

⏰ *Lembrete da Myllenet*: sua fatura vence em *3 dias*!

📋 ${inv.descricao}
💰 Valor: ${formatCurrency(inv.valor_centavos)}
📅 Vencimento: ${formatDate(inv.vencimento)}${inv.efi_link ? `\n\n🔗 Boleto: ${inv.efi_link}` : ""}${inv.efi_pix_copiacola ? `\n\n📱 PIX Copia e Cola:\n${inv.efi_pix_copiacola}` : ""}

Evite a suspensão do serviço. Pague em dia! 😊

_Equipe Myllenet_`;

      try {
        const ok = await sendWhatsApp(customer.telefone, message);
        if (ok) {
          await sendSupportButton(customer.telefone);
          sent++;
          await logNotification(supabase, {
            customer_id: inv.customer_id,
            customer_name: customer.nome,
            phone: customer.telefone,
            type: "lembrete_vencimento",
            message,
            status: "sent",
          });
        } else {
          failed++;
          await logNotification(supabase, {
            customer_id: inv.customer_id,
            customer_name: customer.nome,
            phone: customer.telefone,
            type: "lembrete_vencimento",
            message,
            status: "failed",
            error_message: "WhatsApp API returned non-ok status",
          });
        }
      } catch (err) {
        console.error(`Failed to send reminder to ${customer.nome}:`, err);
        failed++;
        await logNotification(supabase, {
          customer_id: inv.customer_id,
          customer_name: customer.nome,
          phone: customer.telefone,
          type: "lembrete_vencimento",
          message,
          status: "failed",
          error_message: err.message,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const result = {
      invoices_due_in_3_days: invoices.length,
      sent,
      failed,
      skipped_no_phone: skipped.length,
    };
    console.log("Reminder result:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Due reminder error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
