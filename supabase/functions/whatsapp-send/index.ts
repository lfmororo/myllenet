import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { waSendText, waSendDocument, waSendSupportButton, waTestConnection, getWhatsAppConfig } from "../_shared/whatsapp.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UAZAPI_BASE_URL = "https://ipazua.uazapi.com"; 
const BOT_DISCLAIMER = "\n\n🤖 _Esta é uma mensagem automática. Para falar com um atendente, entre em contato: (85) 98680-1458_";
const UAZAPI_FILE_ENDPOINT = "/send/media"; 
const UAZAPI_TEXT_ENDPOINT = "/send/text";

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Helper removed as we prefer verifyAdmin to use admin client with passed token directly.

function tokenRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    return typeof decoded?.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.replace("Bearer ", "").trim();

  // Allow service role key (or any service-role token) for server-to-server calls
  if (
    token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    tokenRole(token) === "service_role"
  ) {
    return "service_role";
  }


  const adminClient = getSupabaseAdmin();
  const { data: { user }, error } = await adminClient.auth.getUser(token);
  
  if (error || !user) {
    console.error("Auth error:", error);
    throw new Error("Unauthorized");
  }

  const userId = user.id;
  const admin = getSupabaseAdmin();
  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleData) throw new Error("Forbidden: admin only");
  return userId;
}

// Dispatcher: envia pelo provedor escolhido em Configurações > WhatsApp
// (uazapi ou Evolution API), mantendo a assinatura antiga por compatibilidade.
async function uazapiRequest(endpoint: string, body: any) {
  if (endpoint === UAZAPI_TEXT_ENDPOINT || endpoint === "/send/text") {
    return await waSendText(body.number, body.text);
  }
  if (endpoint === UAZAPI_FILE_ENDPOINT || endpoint === "/send/media") {
    return await waSendDocument(body.number, body.file, body.docName || "documento.pdf", body.text || "");
  }
  if (endpoint === "/send/menu") {
    return await waSendSupportButton(body.number);
  }
  throw new Error(`Endpoint WhatsApp não suportado: ${endpoint}`);
}

async function sendSupportButton(phone: string) {
  await waSendSupportButton(phone);
}


function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (!digits.startsWith("55")) {
    digits = "55" + digits;
  }
  // Fix Brazilian mobile numbers missing the 9th digit
  // Format should be 55 + DDD(2) + 9 + number(8) = 13 digits
  // If 12 digits (55 + DDD + 8-digit number), insert 9 after DDD
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = `55${ddd}9${number}`;
  }
  return digits;
}

async function logNotification(params: {
  customer_id?: string;
  customer_name: string;
  phone?: string;
  type: string;
  message: string;
  status: "sent" | "failed";
  error_message?: string;
}) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("notification_logs").insert({
      customer_id: params.customer_id || null,
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

async function sendText(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { phone, message, customer_id, customer_name } = await req.json();
  if (!phone || !message) {
    return new Response(JSON.stringify({ error: "phone e message obrigatórios" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const formattedPhone = formatPhone(phone);
    const fullMessage = message + BOT_DISCLAIMER;
    const result = await uazapiRequest(UAZAPI_TEXT_ENDPOINT, {
      number: formattedPhone,
      text: fullMessage,
    });

    await sendSupportButton(formattedPhone);

    await logNotification({
      customer_id,
      customer_name: customer_name || phone,
      phone,
      type: "manual",
      message: fullMessage,
      status: "sent",
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await logNotification({
      customer_id,
      customer_name: customer_name || phone,
      phone,
      type: "manual",
      message,
      status: "failed",
      error_message: err.message,
    });

    console.error("WhatsApp send error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao enviar WhatsApp" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function sendBulk(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages array obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const msg of messages) {
    try {
      const formattedPhone = formatPhone(msg.phone);
      const fullMsg = msg.message + BOT_DISCLAIMER;
      await uazapiRequest(UAZAPI_TEXT_ENDPOINT, {
        number: formattedPhone,
        text: fullMsg,
      });
      await sendSupportButton(formattedPhone);
      success++;

      await logNotification({
        customer_id: msg.customer_id,
        customer_name: msg.customer_name || msg.phone,
        phone: msg.phone,
        type: msg.type || "bulk",
        message: fullMsg,
        status: "sent",
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      failed++;
      errors.push(`${msg.phone}: ${err.message}`);

      await logNotification({
        customer_id: msg.customer_id,
        customer_name: msg.customer_name || msg.phone,
        phone: msg.phone,
        type: msg.type || "bulk",
        message: msg.message,
        status: "failed",
        error_message: err.message,
      });
    }
  }

  return new Response(JSON.stringify({ success, failed, errors }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendInvoiceNotification(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { invoice_id, type } = await req.json();
  if (!invoice_id) {
    return new Response(JSON.stringify({ error: "invoice_id obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*, customers(nome, telefone, cpf)")
    .eq("id", invoice_id)
    .single();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ error: "Fatura não encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const customer = (invoice as any).customers;
  if (!customer?.telefone) {
    return new Response(JSON.stringify({ error: "Cliente sem telefone cadastrado" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const vencimento = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR");

  let message = "";
  const notifType = type || "boleto_gerado";

  switch (notifType) {
    case "boleto_gerado": {
      const mesRef = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' });
      message = `Olá ${customer.nome}! 🌐\n\nSua fatura da *Mororo.Tech* referente a *${mesRef}* foi gerada:\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
      
      message += "\n\nQualquer dúvida, estamos à disposição! 😊";
      break;
    }
    case "lembrete_vencimento":
      message = `Olá ${customer.nome}! 🌐\n\n⏰ Lembrete: sua fatura da *Mororo.Tech* vence em breve!\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
      message += "\n\nEvite a suspensão do serviço. Pague em dia! 😊";
      break;
    case "pagamento_confirmado":
      const mesRefPag = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' });
      message = `Olá ${customer.nome}! 🌐\n\n✅ Pagamento confirmado!\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}\n📂 Referência: ${mesRefPag}\n\nObrigado por manter sua internet em dia! 🚀`;
      break;
    case "cobranca_atrasada":
      message = `Olá ${customer.nome}! 🌐\n\n⚠️ Sua fatura da *Mororo.Tech* está vencida!\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}`;
      break;
    default:
      message = `Olá ${customer.nome}! Informação sobre sua fatura: ${invoice.descricao} - ${valor}`;
  }

  try {
    const formattedPhone = formatPhone(customer.telefone);
    const invoiceUrl = `https://myllenet.lovable.app/fatura/${invoice_id}`;
    const fullMessage = message + BOT_DISCLAIMER;
    
    // First send the text message with the link
    const result = await uazapiRequest(UAZAPI_TEXT_ENDPOINT, {
      number: formattedPhone,
      text: fullMessage,
    });

    // If it's a billing notification, try to send the PDF attachment as well
    if (["boleto_gerado", "lembrete_vencimento", "cobranca_atrasada"].includes(notifType)) {
      const pdfUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-invoice-pdf?invoice_id=${invoice_id}&t=${Date.now()}`;
      const fileName = `Fatura_${invoice.descricao.replace(/\s+/g, '_')}.pdf`;
      
      console.log(`[PDF] Requesting UAZAPI to send PDF from URL: ${pdfUrl} (Phone: ${formattedPhone})`);
      
      try {
        // UAZAPI /send/media expects type: "document" for PDF files and the URL in the "file" field
        const fileResult = await uazapiRequest(UAZAPI_FILE_ENDPOINT, {
          number: formattedPhone,
          type: "document",
          file: pdfUrl,
          delay: 2000,
          text: `Fatura Mororo.Tech - ${invoice.descricao}`,
          docName: fileName
        });
        console.log("[PDF] UAZAPI response:", fileResult);
      } catch (fileErr) {
        console.error("[PDF] Error attaching PDF:", fileErr);
        await logNotification({
          customer_id: invoice.customer_id,
          customer_name: customer.nome,
          phone: customer.telefone,
          type: `${notifType}_pdf_fail`,
          message: `Erro no anexo PDF: ${fileErr.message}`,
          status: "failed",
          error_message: fileErr.message,
        });
      }
    }

    await sendSupportButton(formattedPhone);

    await logNotification({
      customer_id: invoice.customer_id,
      customer_name: customer.nome,
      phone: customer.telefone,
      type: notifType,
      message: fullMessage,
      status: "sent",
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await logNotification({
      customer_id: invoice.customer_id,
      customer_name: customer.nome,
      phone: customer.telefone,
      type: notifType,
      message,
      status: "failed",
      error_message: err.message,
    });

    console.error("WhatsApp notification error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao enviar notificação" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function resendPaidNotifications(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { invoice_ids } = await req.json();
  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
    return new Response(JSON.stringify({ error: "invoice_ids array obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;
  for (const id of invoice_ids) {
    try {
      const supabase = getSupabaseAdmin();
      const { data: invoice } = await supabase.from("invoices").select("*, customers(nome, telefone, cpf)").eq("id", id).single();
      if (!invoice) { failed++; continue; }
      const customer = (invoice as any).customers;
      if (!customer?.telefone) { 
        await logNotification({ customer_id: invoice.customer_id, customer_name: customer?.nome || "?", type: "pagamento_confirmado", message: `Pagamento: ${invoice.descricao}`, status: "failed", error_message: "Sem telefone" });
        failed++; continue; 
      }

      const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const vencimento = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR");
      const mesRefPag = new Date(invoice.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { month: 'long', year: 'numeric' });
      const message = `Olá ${customer.nome}! 🌐\n\n✅ Pagamento confirmado!\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n📅 Vencimento: ${vencimento}\n📂 Referência: ${mesRefPag}\n\nObrigado por manter sua internet em dia! 🚀`;
      const formattedPhone = formatPhone(customer.telefone);

      const fullMessage = message + BOT_DISCLAIMER;
      await uazapiRequest(UAZAPI_TEXT_ENDPOINT, { number: formattedPhone, text: fullMessage });
      await sendSupportButton(formattedPhone);
      await logNotification({ customer_id: invoice.customer_id, customer_name: customer.nome, phone: customer.telefone, type: "pagamento_confirmado", message: fullMessage, status: "sent" });
      sent++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      failed++;
      console.error("Resend error:", err);
    }
  }

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resendOpenInvoices(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);
  const supabase = getSupabaseAdmin();
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id")
    .in("status", ["pending", "waiting", "overdue"])
    .order("vencimento", { ascending: true });
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  const errors: Array<{ invoice_id: string; error: string }> = [];
  const serviceToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  for (const invoice of invoices || []) {
    try {
      const internalRequest = new Request(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send/notify-invoice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoice.id, type: "boleto_gerado" }),
      });
      const response = await sendInvoiceNotification(internalRequest);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Falha HTTP ${response.status}`);
      }
      sent++;
    } catch (err) {
      failed++;
      errors.push({ invoice_id: invoice.id, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return new Response(JSON.stringify({ success: failed === 0, total: invoices?.length || 0, sent, failed, errors }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    switch (path) {
      // chamada sem sub-rota (functions.invoke('whatsapp-send')) => envio de texto
      case "whatsapp-send":
      case "send-text":
        return await sendText(req);
      case "send-bulk":
        return await sendBulk(req);
      case "notify-invoice":
        return await sendInvoiceNotification(req);
      case "resend-paid":
        return await resendPaidNotifications(req);
      case "resend-open-invoices":
        return await resendOpenInvoices(req);
      case "test": {
        await verifyAdmin(req.headers.get("Authorization"));
        const cfg = await getWhatsAppConfig();
        try {
          const result = await waTestConnection();
          return new Response(JSON.stringify({ success: true, provider: cfg.provider, ...result }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, provider: cfg.provider, error: err.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      default:
        return new Response(JSON.stringify({ error: "Endpoint não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("WhatsApp function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: err.message?.includes("Unauthorized") ? 401 : err.message?.includes("Forbidden") ? 403 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
