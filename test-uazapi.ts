import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

async function test() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRole);

  // 1. Get UAZAPI Token
  const { data: settings } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "uazapi_token")
    .maybeSingle();
  
  const token = settings?.value || Deno.env.get("UAZAPI_TOKEN");
  if (!token) {
    console.error("UAZAPI Token not found");
    return;
  }

  // 2. Get an invoice ID
  const { data: invoice } = await supabase.from("invoices").select("id").limit(1).single();
  if (!invoice) {
    console.error("No invoice found to test");
    return;
  }

  const pdfUrl = `${supabaseUrl}/functions/v1/generate-invoice-pdf?invoice_id=${invoice.id}`;
  
  console.log("Testing PDF Accessibility...");
  const pdfResp = await fetch(pdfUrl);
  console.log("PDF Endpoint Status:", pdfResp.status);
  if (pdfResp.ok) {
    const pdfData = await pdfResp.json();
    console.log("PDF Data Sample:", JSON.stringify(pdfData).substring(0, 100));
  } else {
    console.error("PDF Fetch Failed:", await pdfResp.text());
  }
}

test();
