import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { waSendText, waSendSupportButton, formatPhone } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UAZAPI_BASE_URL = "https://ipazua.uazapi.com";
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
  customer_name: string;
  phone?: string;
  type: string;
  message: string;
  status: "sent" | "failed";
  error_message?: string;
}) {
  try {
    await supabase.from("notification_logs").insert({
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
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const { data: dueToday } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .eq("vencimento", todayStr)
      .eq("status", "pending");

    const { data: overdue } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .lt("vencimento", todayStr)
      .in("status", ["pending", "overdue"]);

    // Fetch reconciliations and automated updates from logs for the last 24 hours
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const { data: efiLogs } = await supabase
      .from("efi_api_logs")
      .select("*")
      .gte("created_at", yesterday.toISOString())
      .eq("context", "bulk_check");

    const { data: recentPaid } = await supabase
      .from("invoices")
      .select("id, valor_centavos, efi_charge_id")
      .eq("status", "paid")
      .gte("paid_at", yesterday.toISOString());

    const dueTodayList = dueToday || [];
    const overdueList = overdue || [];
    const reconciledList = recentPaid || [];

    if (dueTodayList.length === 0 && overdueList.length === 0) {
      console.log("No overdue or due-today invoices found.");
      return new Response(JSON.stringify({ message: "Nenhum inadimplente ou vencendo hoje." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formatCurrency = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const formatDate = (d: string) => {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    };

    let message = `📊 *Relatório Diário Mororo.Tech* - ${formatDate(todayStr)}\n\n`;

    if (dueTodayList.length > 0) {
      message += `📅 *Vencendo hoje (${dueTodayList.length}):*\n`;
      for (const inv of dueTodayList) {
        const c = (inv as any).customers;
        message += `• ${c?.nome || "—"} (${c?.usuario_pppoe || "—"}) - ${formatCurrency(inv.valor_centavos)}\n`;
      }
      message += "\n";
    }

    if (overdueList.length > 0) {
      const totalOverdue = overdueList.reduce((s: number, i: any) => s + i.valor_centavos, 0);
      message += `⚠️ *Inadimplentes (${overdueList.length}) - Total: ${formatCurrency(totalOverdue)}:*\n`;
      
      const sorted = overdueList.sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento));
      for (const inv of sorted.slice(0, 30)) {
        const c = (inv as any).customers;
        const daysLate = Math.floor((today.getTime() - new Date(inv.vencimento + "T12:00:00").getTime()) / 86400000);
        message += `• ${c?.nome || "—"} - ${formatCurrency(inv.valor_centavos)} (${daysLate}d atraso)\n`;
      }
      if (sorted.length > 30) {
        message += `... e mais ${sorted.length - 30} cobranças\n`;
      }
      if (sorted.length > 30) {
        message += `... e mais ${sorted.length - 30} cobranças\n`;
      }
      message += "\n";
    }

    if (reconciledList.length > 0) {
      const totalReconciled = reconciledList.reduce((s: number, i: any) => s + i.valor_centavos, 0);
      message += `✅ *Baixas Automáticas (24h): ${reconciledList.length}*\n`;
      message += `💰 *Total Recuperado: ${formatCurrency(totalReconciled)}*\n\n`;
    }

    message += "\n_Relatório automático do sistema Mororo.Tech_";

    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      console.log("No admin users found.");
      return new Response(JSON.stringify({ message: "Nenhum admin encontrado." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const role of adminRoles) {
      const { data: { user } } = await supabase.auth.admin.getUserById(role.user_id);
      const phone = user?.user_metadata?.phone || user?.phone;
      if (!phone) {
        console.log(`Admin ${role.user_id} has no phone number, skipping.`);
        continue;
      }

      try {
        const fullMessage = message + BOT_DISCLAIMER;
        const ok = await sendWhatsApp(phone, fullMessage);
        if (ok) {
          await sendSupportButton(phone);
          sent++;
          await logNotification(supabase, {
            customer_name: "Admin",
            phone,
            type: "relatorio_diario",
            message,
            status: "sent",
          });
        } else {
          failed++;
          await logNotification(supabase, {
            customer_name: "Admin",
            phone,
            type: "relatorio_diario",
            message,
            status: "failed",
          });
        }
      } catch (err) {
        console.error(`Failed to send to admin ${role.user_id}:`, err);
        failed++;
        await logNotification(supabase, {
          customer_name: "Admin",
          phone,
          type: "relatorio_diario",
          message,
          status: "failed",
          error_message: err.message,
        });
      }
    }

    if (overdueList.length > 0) {
      const overdueIds = overdueList.filter((i: any) => i.status === "pending").map((i: any) => i.id);
      if (overdueIds.length > 0) {
        await supabase.from("invoices").update({ status: "overdue" }).in("id", overdueIds);
      }
    }

    const result = {
      due_today: dueTodayList.length,
      overdue: overdueList.length,
      notifications_sent: sent,
      notifications_failed: failed,
    };
    console.log("Daily report result:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Daily report error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
