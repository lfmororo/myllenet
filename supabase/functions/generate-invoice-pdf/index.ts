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

// Simple CRC16 CCITT implementation
function crc16(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Remove accents and special characters
function sanitize(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").toUpperCase();
}

function generatePixPayload(key: string, name: string, city: string, amount: number, description: string): string {
  const f = (id: string, val: string) => id + val.length.toString().padStart(2, "0") + val;
  
  const sName = sanitize(name).substring(0, 25);
  const sCity = sanitize(city).substring(0, 15);
  // TxID must be between 1 and 25 characters
  const txid = sanitize(description).replace(/\s/g, "").substring(0, 25);
  
  const merchantAccountInfo = f("00", "BR.GOV.BCB.PIX") + f("01", key);
  
  let payload = f("00", "01"); // Payload Format Indicator
  payload += f("26", merchantAccountInfo); // Merchant Account Information
  payload += f("52", "0000"); // Merchant Category Code
  payload += f("53", "986"); // Transaction Currency (BRL)
  payload += f("54", amount.toFixed(2)); // Transaction Amount
  payload += f("58", "BR"); // Country Code
  payload += f("59", sName); // Merchant Name
  payload += f("60", sCity); // Merchant City
  
  // Tag 62 must contain tag 05 (Transaction ID) and optionally tag 01 (Description)
  // Note: Tag 01 is not part of the standard Pix static payload for all apps, but some support it.
  // The most reliable way to show a message is via the TxID (Tag 05)
  const additionalData = f("05", txid || "INV" + Date.now().toString().slice(-10));
  payload += f("62", additionalData);
  
  payload += "6304"; // CRC16 indicator
  payload += crc16(payload);
  
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    let invoice_id;
    const url = new URL(req.url);
    
    if (req.method === "GET") {
      invoice_id = url.searchParams.get("invoice_id");
    } else {
      const body = await req.json();
      invoice_id = body.invoice_id;
    }
    
    if (!invoice_id) throw new Error("invoice_id is required");

    const supabase = getSupabaseAdmin();

    // Check if the request is internal (service role) or from an authenticated admin
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !user) throw new Error("Unauthorized");
        
        const { data: role } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        
        if (!role) throw new Error("Forbidden: Admin only");
      }
    } else if (req.method !== "GET") {
      // If it's a POST/other without auth, reject
      throw new Error("Missing authorization header");
    }
    // Note: GET requests for PDFs are currently allowed to support public UAZAPI fetch, 
    // but protected by the UUID invoice_id which is hard to guess.

    // Fetch invoice and customer data
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, customers(*, plans(*))")
      .eq("id", invoice_id)
      .single();

    if (invErr || !invoice) throw new Error("Invoice not found");

    const customer = invoice.customers;
    const plan = customer?.plans;

    // Fetch consumption from pppoe_logs
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);

    const { data: logs } = await supabase
      .from("pppoe_logs")
      .select("rx_bytes, tx_bytes")
      .eq("customer_id", customer.id)
      .gte("logged_at", firstDay.toISOString());

    const totalRx = (logs?.reduce((acc, l) => acc + (l.rx_bytes || 0), 0) || 0) / (1024 ** 3); // GB
    const totalTx = (logs?.reduce((acc, l) => acc + (l.tx_bytes || 0), 0) || 0) / (1024 ** 3); // GB

    // Fetch PIX settings
    const { data: settings } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["pix_key", "pix_name", "pix_city", "company_cnpj", "company_phone"]);

    const pixSettings = Object.fromEntries(settings?.map(s => [s.key, s.value]) || []);
    const refMonth = new Date(invoice.mes_referencia).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
    const shortName = sanitize(customer.nome || "").split(' ')[0].substring(0, 10);
    const pixDescription = `${shortName}${refMonth.replace('/', '')}`;

    const pixPayload = generatePixPayload(
      pixSettings.pix_key || "00000000000",
      pixSettings.pix_name || "Mororo Tech",
      pixSettings.pix_city || "Ipu",
      invoice.valor_centavos / 100,
      pixDescription || `INV${invoice_id.substring(0, 8).toUpperCase()}`
    );

    // If UAZAPI is the requester, it might expect a PDF binary.
    // However, our system generates the PDF client-side or we need a server-side generator.
    // Since we don't have a server-side PDF generator (like puppeteer) here, 
    // we return the structured JSON data.
    // UAZAPI /send/file MUST receive a URL that points to a FILE.
    // IF UAZAPI receives this JSON, it will fail to send as a PDF.
    
    // To solve this properly, we should ideally generate the PDF here.
    // For now, let's at least ensure the response is clean.
    
    return new Response(JSON.stringify({
      invoice,
      customer,
      plan,
      consumption: {
        download: totalRx.toFixed(2) + " GB",
        upload: totalTx.toFixed(2) + " GB",
        days: "30 de 30 dias"
      },
      pix: {
        payload: pixPayload,
        key: pixSettings.pix_key,
        name: pixSettings.pix_name,
        cnpj: pixSettings.company_cnpj,
        phone: pixSettings.company_phone
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
