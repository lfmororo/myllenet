import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import QRCode from "https://esm.sh/qrcode@1.5.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      .in("key", ["pix_key", "pix_name", "pix_city", "company_cnpj", "company_phone", "company_address"]);

    // Fetch consumption data for the month
    const startOfMonth = new Date(invoice.vencimento);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(invoice.vencimento);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const { data: consumptionData } = await supabase
      .from("pppoe_logs")
      .select("rx_bytes, tx_bytes, event_type")
      .eq("customer_id", customer.id)
      .gte("logged_at", startOfMonth.toISOString())
      .lte("logged_at", endOfMonth.toISOString());

    const totalDownload = (consumptionData?.reduce((acc, log) => acc + (Number(log.rx_bytes) || 0), 0) || 0) / (1024 * 1024 * 1024);
    const totalUpload = (consumptionData?.reduce((acc, log) => acc + (Number(log.tx_bytes) || 0), 0) || 0) / (1024 * 1024 * 1024);
    const interruptions = consumptionData?.filter(log => log.event_type === 'disconnected').length || 0;

    const pixSettings = Object.fromEntries(settings?.map(s => [s.key, s.value]) || []);
    const refDate = new Date(invoice.vencimento + "T12:00:00");
    const refMonth = refDate.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
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
    const pageHeight = doc.internal.pageSize.getHeight();
    const primaryColor = [15, 23, 42];
    const accentColor = [13, 148, 136];
    const textColor = [30, 41, 59];
    const lightTextColor = [71, 85, 105];

    // Header Area with Logo Background
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, 50, "F");
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, pageWidth, 5, "F");

    // Title
    doc.setFontSize(22);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont("helvetica", "bold");
    doc.text("FATURA", pageWidth - 20, 26, { align: "right" });

    doc.setFontSize(9);
    doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
    doc.text(`#${invoice_id.substring(0, 8).toUpperCase()}`, pageWidth - 20, 32, { align: "right" });

    // Logo
    try {
      const logoUrl = "https://id-preview--6764dda2-b135-4fa9-a305-075890df89c3.lovable.app/logo.png";
      const resp = await fetch(logoUrl, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        doc.addImage(`data:image/png;base64,${base64}`, "PNG", 20, 12, 50, 20);
      } else {
        console.error(`[PDF] Logo fetch failed: ${resp.status}`);
        doc.setFontSize(16);
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.text("Mororo.Tech", 20, 26);
      }
    } catch (e) {
      doc.setFontSize(16);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("Mororo.Tech", 20, 26);
    }

    let currentY = 60;


    // Company Info
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(pixSettings.pix_name || "Mororo.Tech", 20, currentY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(`CNPJ: ${pixSettings.company_cnpj || "00.000.000/0000-00"}`, 20, currentY + 6);
    doc.text(pixSettings.company_address || "Ipu - Ceará", 20, currentY + 12);
    doc.text(`Contato: ${pixSettings.company_phone || "(85) 98680-1458"}`, 20, currentY + 18);

    // Customer Info
    doc.setFont("helvetica", "bold");
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("DADOS DO CLIENTE", 120, currentY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(customer.nome, 120, currentY + 6);
    doc.text(`CPF/CNPJ: ${customer.cpf}`, 120, currentY + 12);
    doc.text(`${customer.rua || ""}, ${customer.numero || ""}`, 120, currentY + 18);
    doc.text(`${customer.bairro || ""} - ${customer.cidade || ""}`, 120, currentY + 24);

    currentY += 40;

    // Service Summary
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(20, currentY, pageWidth - 40, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text("DESCRIÇÃO", 25, currentY + 7);
    doc.text("VENCIMENTO", 100, currentY + 7);
    doc.text("VALOR", pageWidth - 25, currentY + 7, { align: "right" });

    currentY += 18;
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(invoice.descricao, 25, currentY);
    doc.text(new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR"), 100, currentY);
    doc.text((invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), pageWidth - 25, currentY, { align: "right" });

    currentY += 15;

    // Technical Info / Consumption
    doc.setFillColor(248, 250, 252);
    doc.rect(20, currentY, pageWidth - 40, 25, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(20, currentY, pageWidth - 40, 25, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
    doc.text("INFORMAÇÕES TÉCNICAS DO PERÍODO", 25, currentY + 7);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(`Trafego Download: ${totalDownload.toFixed(2)} GB`, 25, currentY + 15);
    doc.text(`Trafego Upload: ${totalUpload.toFixed(2)} GB`, 80, currentY + 15);
    doc.text(`Interrupções: ${interruptions}`, 140, currentY + 15);
    doc.text(`Plano Contratado: ${plan?.nome || "Internet Residencial"}`, 25, currentY + 20);

    currentY += 35;


    // PIX Area
    doc.setFontSize(12);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.setFont("helvetica", "bold");
    doc.text("PAGAMENTO VIA PIX", 20, currentY);
    
    currentY += 10;
    const qrCodeDataUrl = await QRCode.toDataURL(pixPayload, { margin: 1 });
    doc.addImage(qrCodeDataUrl, "PNG", 20, currentY, 50, 50);

    doc.setFontSize(9);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.setFont("helvetica", "bold");
    doc.text("PIX COPIA E COLA:", 80, currentY + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const splitPayload = doc.splitTextToSize(pixPayload, pageWidth - 100);
    doc.text(splitPayload, 80, currentY + 12);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("CHAVE PIX:", 80, currentY + 35);
    doc.setFont("helvetica", "normal");
    doc.text(pixSettings.pix_key || "N/A", 110, currentY + 35);

    currentY += 70;
    doc.setFontSize(8);
    doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
    doc.text("Escaneie o QR Code ou use o Copia e Cola para pagamento imediato.", 20, currentY);

    // Footer
    doc.setFontSize(7);
    doc.text("ESTA É UMA FATURA DE SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA.", 20, pageHeight - 10);
    doc.text("Mororo.Tech © 2026", pageWidth - 20, pageHeight - 10, { align: "right" });

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
