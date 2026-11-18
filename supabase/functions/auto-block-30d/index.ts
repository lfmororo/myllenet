import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
    
    // Calculate the date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    console.log(`[Blocking] Searching for invoices overdue since ${thirtyDaysAgoStr} (30+ days)`);

    // 1. Find customers with invoices that are 'pending' or 'overdue' and expired more than 30 days ago
    // We only care about customers who are not already 'blocked'
    const { data: overdueInvoices, error: invErr } = await supabase
      .from("invoices")
      .select(`
        id,
        customer_id,
        vencimento,
        status,
        customers!inner (
          id,
          nome,
          block_status,
          ativo
        )
      `)
      .in("status", ["pending", "overdue"])
      .lt("vencimento", thirtyDaysAgoStr)
      .eq("customers.block_status", "active")
      .eq("customers.ativo", true);

    if (invErr) throw invErr;

    const customersToBlock = new Map();
    overdueInvoices?.forEach(inv => {
      if (!customersToBlock.has(inv.customer_id)) {
        customersToBlock.set(inv.customer_id, { ...inv.customers, invoice_id: inv.id });
      }
    });

    console.log(`[Blocking] Found ${customersToBlock.size} customers to block.`);

    const results = [];

    for (const [customerId, customer] of customersToBlock.entries()) {
      try {
        // 2. Update customer status in DB
        const { error: updErr } = await supabase
          .from("customers")
          .update({ block_status: "blocked" })
          .eq("id", customerId);

        if (updErr) throw updErr;

        // 3. Log to block_history
        await supabase.from("block_history").insert({
          customer_id: customerId,
          old_status: "active",
          new_status: "blocked",
          reason: "Bloqueio automático: fatura vencida há mais de 30 dias",
          changed_by: null // System action
        });

        results.push({ customer: customer.nome, status: "blocked" });
      } catch (err) {
        console.error(`[Blocking] Failed to block ${customer.nome}:`, err);
        results.push({ customer: customer.nome, status: "error", error: err.message });
      }
    }

    // 5. Trigger Mikrotik Sync to apply changes to the router immediately
    try {
      await supabase.functions.invoke("mikrotik-sync");
    } catch (syncErr) {
      console.error("[Blocking] Failed to trigger Mikrotik sync:", syncErr);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: customersToBlock.size,
      results 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[Blocking] Global error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
