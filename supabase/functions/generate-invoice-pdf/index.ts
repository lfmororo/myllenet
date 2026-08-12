import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import QRCode from "https://esm.sh/qrcode@1.5.3";

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

function sanitize(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").toUpperCase();
}

function generatePixPayload(key: string, name: string, city: string, amount: number, description: string): string {
  const f = (id: string, val: string) => id + val.length.toString().padStart(2, "0") + val;
  const sName = sanitize(name).substring(0, 25);
  const sCity = sanitize(city).substring(0, 15);
  const txid = sanitize(description).replace(/\s/g, "").substring(0, 25);
  const merchantAccountInfo = f("00", "BR.GOV.BCB.PIX") + f("01", key);
  let payload = f("00", "01");
  payload += f("26", merchantAccountInfo);
  payload += f("52", "0000");
  payload += f("53", "986");
  payload += f("54", amount.toFixed(2));
  payload += f("58", "BR");
  payload += f("59", sName);
  payload += f("60", sCity);
  const additionalData = f("05", txid || "INV" + Date.now().toString().slice(-10));
  payload += f("62", additionalData);
  payload += "6304";
  payload += crc16(payload);
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const invoice_id = url.searchParams.get("invoice_id");
    if (!invoice_id) throw new Error("invoice_id is required");

    const supabase = getSupabaseAdmin();
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, customers(*, plans(*))")
      .eq("id", invoice_id)
      .single();

    if (invErr || !invoice) throw new Error("Invoice not found");

    const customer = invoice.customers;
    const plan = customer?.plans;

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
      pixDescription
    );

    // PDF Generation
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const primaryColor = [15, 23, 42];
    const accentColor = [13, 148, 136];
    const textColor = [30, 41, 59];

    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, pageWidth, 5, "F");

    doc.setFontSize(22);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("FATURA", pageWidth - 20, 26, { align: "right" });

    doc.setFontSize(10);
    doc.text(customer.nome, 20, 60);
    doc.text(`CPF: ${customer.cpf}`, 20, 66);
    doc.text(`Vencimento: ${new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR")}`, 20, 72);
    doc.text(`Valor: ${(invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, 20, 78);

    const qrCodeDataUrl = await QRCode.toDataURL(pixPayload, { margin: 1 });
    doc.addImage(qrCodeDataUrl, "PNG", 20, 90, 50, 50);
    doc.text("Pague com PIX para liberação imediata", 20, 145);

    const pdfOutput = doc.output("arraybuffer");

    return new Response(pdfOutput, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Fatura_${invoice.descricao.replace(/\s+/g, '_')}.pdf"`
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
