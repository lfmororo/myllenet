import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstDayStr = firstDay.toISOString().split('T')[0];

    // Identify active customers who don't have an invoice for this month yet
    // This is a simplified logic, usually we check if there's an invoice 
    // where vencimento is in the current month
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("*, plans(*)")
      .eq("ativo", true)
      .eq("cortesia", false);

    if (custErr) throw custErr;

    const results = [];

    for (const customer of customers) {
      // Check if invoice already exists for this month
      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("customer_id", customer.id)
        .gte("vencimento", firstDayStr)
        .maybeSingle();

      if (existing) continue;

      // Create invoice
      const vencimento = new Date(today.getFullYear(), today.getMonth(), customer.dia_vencimento || 10);
      const vencimentoStr = vencimento.toISOString().split('T')[0];
      const valor = (customer.plans?.valor_centavos || 0) - (customer.desconto_especial_centavos || 0);

      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          customer_id: customer.id,
          plan_id: customer.plan_id,
          valor_centavos: valor,
          vencimento: vencimentoStr,
          descricao: `Mensalidade Internet - ${today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
          status: 'pending'
        })
        .select()
        .single();

      if (invErr) {
        results.push({ customer: customer.nome, status: 'error', error: invErr.message });
        continue;
      }

      // Trigger WhatsApp notification via the other edge function
      // In a real env, we call it internally or via fetch
      const projectId = Deno.env.get("SUPABASE_PROJECT_ID");
      const baseUrl = Deno.env.get("SUPABASE_URL") || `https://${projectId}.supabase.co`;
      await fetch(`${baseUrl}/functions/v1/whatsapp-send/notify-invoice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invoice_id: invoice.id, type: 'boleto_gerado' })
      });

      results.push({ customer: customer.nome, status: 'created', invoice_id: invoice.id });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
