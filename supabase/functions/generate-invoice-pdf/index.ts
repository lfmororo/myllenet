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

function maskCustomerName(value?: string | null): string {
  const parts = (value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.slice(1).map((part) => `${part.charAt(0).toUpperCase()}.`).join(" ")}`;
}

function maskDocument(value?: string | null): string {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  if (digits.length >= 2) return `${"*".repeat(Math.min(digits.length - 2, 12))}${digits.slice(-2)}`;
  return "Não informado";
}

function maskedCustomerLocation(customer: { bairro?: string | null; cidade?: string | null }): string {
  const location = [customer?.bairro, customer?.cidade].filter(Boolean).join(" - ");
  return location ? `Endereço protegido - ${location}` : "Endereço protegido";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / Math.pow(1024, index)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${units[index]}`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}min`);
  return parts.join(" ");
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
    let invoice_id = null;
    if (req.method === "POST") {
      const body = await req.json();
      invoice_id = body.invoice_id;
    } else {
      const url = new URL(req.url);
      invoice_id = url.searchParams.get("invoice_id");
    }
    
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
      .in("key", ["pix_key", "pix_name", "pix_city", "company_cnpj", "company_phone", "company_address", "payment_gateway"]);

    const pixSettings = Object.fromEntries(settings?.map(s => [s.key, s.value]) || []);

    // Métricas reais do mês de vencimento, limitadas ao momento atual.
    const [year, month] = String(invoice.vencimento).split("-").map(Number);
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
    const naturalEnd = new Date(Date.UTC(year, month, 1, 2, 59, 59, 999));
    const endOfMonth = new Date(Math.min(naturalEnd.getTime(), Date.now()));
    const { data: metricRows, error: metricsError } = await supabase.rpc("get_invoice_network_metrics", {
      _customer_id: customer.id,
      _from: startOfMonth.toISOString(),
      _to: endOfMonth.toISOString(),
    });
    if (metricsError) throw new Error(`Falha ao calcular métricas: ${metricsError.message}`);
    const metrics = metricRows?.[0] || {};
    const totalDownloadBytes = Number(metrics.download_bytes || 0);
    const totalUploadBytes = Number(metrics.upload_bytes || 0);
    const interruptions = Number(metrics.disconnect_count || 0);
    const connectedSeconds = Number(metrics.connected_seconds || 0);
    const disconnectedSeconds = Number(metrics.disconnected_seconds || 0);

    const refDate = new Date(invoice.vencimento + "T12:00:00");
    const refMonth = refDate.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
    const shortName = sanitize(customer.nome || "").split(' ')[0].substring(0, 10);
    const pixDescription = `${shortName}${refMonth.replace('/', '')}`;

    // Pix do Mercado Pago quando ele é a plataforma escolhida; Pix local como reserva
    let pixPayload = invoice.mp_pix_copiacola || "";
    let pixSource: "mercadopago" | "local" = pixPayload ? "mercadopago" : "local";

    if (!pixPayload && pixSettings.payment_gateway === "mercadopago" && invoice.status !== "paid") {
      try {
        const { data: mpPix, error: mpErr } = await supabase.functions.invoke(
          "mercadopago/pix-for-invoice",
          { body: { invoice_id: invoice.id } }
        );
        if (!mpErr && mpPix?.copia_cola) {
          pixPayload = mpPix.copia_cola;
          pixSource = "mercadopago";
        }
      } catch (err) {
        console.error("Falha ao gerar Pix no Mercado Pago:", (err as Error).message);
      }
    }

    if (!pixPayload) {
      pixSource = "local";
      pixPayload = generatePixPayload(
        pixSettings.pix_key || "00000000000",
        pixSettings.pix_name || "Mororo Tech",
        pixSettings.pix_city || "Ipu",
        invoice.valor_centavos / 100,
        pixDescription
      );
    }

    if (req.method === "GET") {
      // PDF Generation for UAZAPI/Direct Download
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
      doc.setFontSize(8);
      doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.text("MylleNet agora é Mororo.Tech", pageWidth - 20, 38, { align: "right" });

      // Logo
      try {
        const logoUrl = "https://myllenet.lovable.app/logo.png";
        const resp = await fetch(logoUrl, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const blob = await resp.blob();
          const buffer = await blob.arrayBuffer();
          const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
          doc.addImage(`data:image/png;base64,${base64}`, "PNG", 20, 12, 50, 20);
        } else {
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
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(pixSettings.pix_name || "Mororo.Tech", 20, currentY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`CNPJ: ${pixSettings.company_cnpj || "00.000.000/0000-00"}`, 20, currentY + 6);
      doc.text(pixSettings.company_address || "Ipu - Ceará", 20, currentY + 12);
      doc.text(`Contato: ${pixSettings.company_phone || "(85) 98680-1458"}`, 20, currentY + 18);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text("DADOS DO CLIENTE", 120, currentY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(maskCustomerName(customer.nome), 120, currentY + 6);
      doc.text(`CPF/CNPJ: ${maskDocument(customer.cpf)}`, 120, currentY + 12);
      doc.text(maskedCustomerLocation(customer), 120, currentY + 18);
      doc.setFontSize(7);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text("Dados pessoais parcialmente ocultos para sua segurança.", 120, currentY + 24);

      currentY += 40;
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
      doc.setFillColor(248, 250, 252);
      doc.rect(20, currentY, pageWidth - 40, 34, "F");
      doc.setDrawColor(226, 232, 240);
      doc.rect(20, currentY, pageWidth - 40, 34, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text("INFORMAÇÕES TÉCNICAS DO PERÍODO", 25, currentY + 7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(`Download: ${formatBytes(totalDownloadBytes)}`, 25, currentY + 15);
      doc.text(`Upload: ${formatBytes(totalUploadBytes)}`, 85, currentY + 15);
      doc.text(`Desconexões: ${interruptions}`, 145, currentY + 15);
      doc.text(`Tempo conectado: ${formatDuration(connectedSeconds)}`, 25, currentY + 22);
      doc.text(`Tempo sem conexão: ${formatDuration(disconnectedSeconds)}`, 100, currentY + 22);
      doc.text(`Plano contratado: ${plan?.nome || "Internet Residencial"}`, 25, currentY + 29);

      currentY += 44;
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
      doc.text(pixSource === "mercadopago" ? "PAGAMENTO:" : "CHAVE PIX:", 80, currentY + 35);
      doc.setFont("helvetica", "normal");
      doc.text(
        pixSource === "mercadopago"
          ? "Pix Mercado Pago (baixa automatica)"
          : pixSettings.pix_key || "N/A",
        pixSource === "mercadopago" ? 105 : 110,
        currentY + 35
      );

      currentY += 70;
      doc.setFontSize(8);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text("Escaneie o QR Code ou use o Copia e Cola para pagamento imediato.", 20, currentY);

      doc.setFontSize(7);
      doc.text("ESTA É UMA FATURA DE SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA.", 20, pageHeight - 14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
      doc.text("MylleNet agora é Mororo.Tech", 20, pageHeight - 10);
      doc.setTextColor(lightTextColor[0], lightTextColor[1], lightTextColor[2]);
      doc.text("Mororo.Tech © 2026", pageWidth - 20, pageHeight - 10, { align: "right" });

      const pdfOutput = doc.output("arraybuffer");
      return new Response(pdfOutput, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Fatura_${invoice.descricao.replace(/\s+/g, '_')}.pdf"`
        },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      data: {
        invoice,
        customer,
        plan,
        consumption: {
          download: formatBytes(totalDownloadBytes),
          upload: formatBytes(totalUploadBytes),
          interruptions,
          connected: formatDuration(connectedSeconds),
          disconnected: formatDuration(disconnectedSeconds),
          period_start: startOfMonth.toISOString(),
          period_end: endOfMonth.toISOString()
        },
        pix: {
          payload: pixPayload,
          source: pixSource,
          key: pixSettings.pix_key,
          name: pixSettings.pix_name,
          cnpj: pixSettings.company_cnpj,
          phone: pixSettings.company_phone
        }
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