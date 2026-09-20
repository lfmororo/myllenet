import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { waSendText, waSendSupportButton } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BOT_DISCLAIMER = "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function sendWhatsApp(phone: string, message: string) {
  try {
    await waSendText(phone, message);
    return true;
  } catch (err) {
    console.error("WhatsApp send error:", err);
    return false;
  }
}

async function sendSupportButton(phone: string) {
  await waSendSupportButton(phone);
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
      const pixCopiaCola = (inv as any).mp_pix_copiacola || inv.efi_pix_copiacola;
      const message = `Olá ${nome}! 🌐

⏰ *Lembrete da Mororo.Tech*: sua fatura vence em *3 dias*!

📋 ${inv.descricao}
💰 Valor: ${formatCurrency(inv.valor_centavos)}
📅 Vencimento: ${formatDate(inv.vencimento)}${inv.efi_link ? `\n\n🔗 Boleto: ${inv.efi_link}` : ""}${pixCopiaCola ? `\n\n📱 PIX Copia e Cola:\n${pixCopiaCola}` : ""}

Evite a suspensão do serviço. Pague em dia! 😊

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
