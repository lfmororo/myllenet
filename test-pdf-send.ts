
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const UAZAPI_BASE_URL = "https://ipazua.uazapi.com";

async function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getUazapiToken(): Promise<string> {
  const supabase = await getSupabaseAdmin();
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

async function testPdfFetch(invoiceId: string) {
  const pdfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-invoice-pdf?invoice_id=${invoiceId}`;
  console.log(`Testing PDF fetch from: ${pdfUrl}`);
  
  const response = await fetch(pdfUrl);
  console.log(`PDF Fetch Status: ${response.status}`);
  if (response.ok) {
    const data = await response.json();
    console.log(`PDF Data Success: ${data.success}`);
  } else {
    console.log(`PDF Fetch Error: ${await response.text()}`);
  }
}

async function testUazapiSend(phone: string, invoiceId: string) {
  const token = await getUazapiToken();
  const pdfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-invoice-pdf?invoice_id=${invoiceId}`;
  
  console.log(`Testing UAZAPI send/file to ${phone}`);
  
  const response = await fetch(`${UAZAPI_BASE_URL}/send/file`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "token": token,
    },
    body: JSON.stringify({
      number: phone,
      url: pdfUrl,
      caption: "Teste de Fatura PDF",
      name: "Fatura_Teste.pdf"
    }),
  });
  
  const result = await response.text();
  console.log(`UAZAPI Status: ${response.status}`);
  console.log(`UAZAPI Result: ${result}`);
}

const invoiceId = Deno.args[0];
const phone = Deno.args[1];

if (invoiceId) {
  await testPdfFetch(invoiceId);
  if (phone) {
    await testUazapiSend(phone, invoiceId);
  }
} else {
  console.log("Please provide an invoice_id as the first argument.");
}
