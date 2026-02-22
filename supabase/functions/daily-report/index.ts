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

async function sendWhatsApp(phone: string, message: string) {
  const token = await getUazapiToken();
  let digits = phone.replace(/\D/g, "");
  if (!digits.startsWith("55")) digits = "55" + digits;

  const response = await fetch(`${UAZAPI_BASE_URL}/sendText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "token": token },
    body: JSON.stringify({ phone: digits, message }),
  });

  const text = await response.text();
  console.log("WhatsApp send result:", response.status, text.slice(0, 200));
  return response.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Get invoices due today (pending)
    const { data: dueToday } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .eq("vencimento", todayStr)
      .eq("status", "pending");

    // Get overdue invoices (pending with past due date)
    const { data: overdue } = await supabase
      .from("invoices")
      .select("*, customers(nome, telefone, cpf, usuario_pppoe)")
      .lt("vencimento", todayStr)
      .in("status", ["pending", "overdue"]);

    const dueTodayList = dueToday || [];
    const overdueList = overdue || [];

    if (dueTodayList.length === 0 && overdueList.length === 0) {
      console.log("No overdue or due-today invoices found.");
      return new Response(JSON.stringify({ message: "Nenhum inadimplente ou vencendo hoje." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build admin notification message
    const formatCurrency = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const formatDate = (d: string) => {
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    };

    let message = `📊 *Relatório Diário Myllenet* - ${formatDate(todayStr)}\n\n`;

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
      
      // Group by days overdue
      const sorted = overdueList.sort((a: any, b: any) => a.vencimento.localeCompare(b.vencimento));
      for (const inv of sorted.slice(0, 30)) {
        const c = (inv as any).customers;
        const daysLate = Math.floor((today.getTime() - new Date(inv.vencimento + "T12:00:00").getTime()) / 86400000);
        message += `• ${c?.nome || "—"} - ${formatCurrency(inv.valor_centavos)} (${daysLate}d atraso)\n`;
      }
      if (sorted.length > 30) {
        message += `... e mais ${sorted.length - 30} cobranças\n`;
      }
    }

    message += "\n_Relatório automático do sistema Myllenet_";

    // Get admin users with phone numbers
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

    // Get admin phone numbers from auth
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
        const ok = await sendWhatsApp(phone, message);
        if (ok) sent++;
        else failed++;
      } catch (err) {
        console.error(`Failed to send to admin ${role.user_id}:`, err);
        failed++;
      }
    }

    // Also update overdue invoices status
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
