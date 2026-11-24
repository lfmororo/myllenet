import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { waSendText } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-signature, x-request-id",
};

const MP_BASE = "https://api.mercadopago.com";
const DEFAULT_SATISFACTION_URL = "https://app.mororo.tech/satisfacao";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

let cachedToken: string | null = null;

// Prioriza o token salvo nas configurações do sistema; usa o secret como reserva.
async function mpToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    const { data } = await getSupabaseAdmin()
      .from("settings")
      .select("value")
      .eq("key", "mercadopago_access_token")
      .maybeSingle();
    if (data?.value?.trim()) {
      cachedToken = data.value.trim();
      return cachedToken;
    }
  } catch (err) {
    console.error("Falha ao ler token nas configurações:", (err as Error).message);
  }
  const envToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!envToken) throw new Error("Access Token do Mercado Pago não configurado");
  cachedToken = envToken;
  return cachedToken;
}

async function mpRequest(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await mpToken()}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${MP_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error(`Mercado Pago ${method} ${path} [${response.status}]:`, text);
    const detail =
      data?.message ||
      data?.cause?.[0]?.description ||
      `Erro Mercado Pago (${response.status})`;
    throw new Error(detail);
  }

  return data;
}

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.replace("Bearer ", "");
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return "service";

  const admin = getSupabaseAdmin();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");

  const { data: roleData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleData) throw new Error("Forbidden: admin only");
  return user.id;
}

function isInternalCron(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  return !!cronSecret && !!provided && provided === cronSecret;
}

async function getSatisfactionUrl(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "satisfaction_url")
      .maybeSingle();
    return data?.value || DEFAULT_SATISFACTION_URL;
  } catch {
    return DEFAULT_SATISFACTION_URL;
  }
}

// ---------------------------------------------------------------- baixa
async function settleInvoice(
  supabase: any,
  invoice: any,
  paidAtIso: string,
) {
  await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: paidAtIso })
    .eq("id", invoice.id);

  const { data: full } = await supabase
    .from("invoices")
    .select("*, customers(*)")
    .eq("id", invoice.id)
    .single();

  const customer = full?.customers;
  if (!full || !customer) return;

  // Desbloqueio automático quando não há mais pendências vencidas
  if (customer.block_status === "blocked") {
    const today = new Date().toISOString().split("T")[0];
    const { count: overdueCount } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .in("status", ["pending", "overdue"])
      .lt("vencimento", today)
      .neq("id", full.id);

    if (!overdueCount) {
      await supabase
        .from("customers")
        .update({ block_status: "active" })
        .eq("id", customer.id);

      await supabase.from("block_history").insert({
        customer_id: customer.id,
        old_status: "blocked",
        new_status: "active",
        reason:
          "Desbloqueio automático: pagamento Mercado Pago confirmado e sem outras pendências vencidas",
        changed_by: null,
      });

      try {
        await supabase.functions.invoke("mikrotik-customer", {
          body: { customer_id: customer.id, action: "enable" },
        });
      } catch (e) {
        console.error("[Unblock] mikrotik-customer falhou:", e);
      }
    }
  }

  const valor = (full.valor_centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const surveyUrl = await getSatisfactionUrl(supabase);
  const message = `Olá ${customer.nome}! 🌐\n\n✅ Pagamento confirmado!\n\n📋 ${full.descricao}\n💰 Valor: ${valor}\n\nObrigado por manter sua internet em dia! 🚀\n\n⭐ *Avalie nosso atendimento*\nSua opinião nos ajuda a melhorar. Se preferir, registre também uma solicitação ou reclamação:\n👉 ${surveyUrl}`;

  if (!customer.telefone) {
    await supabase.from("notification_logs").insert({
      customer_id: full.customer_id,
      customer_name: customer.nome,
      phone: null,
      type: "pagamento_confirmado",
      message,
      status: "failed",
      error_message: "Cliente sem telefone cadastrado",
    });
    return;
  }

  let sendOk = true;
  let sendError: string | null = null;
  try {
    await waSendText(customer.telefone, message);
  } catch (err) {
    sendOk = false;
    sendError = (err as Error).message?.slice(0, 500) || "Erro ao enviar WhatsApp";
  }

  await supabase.from("notification_logs").insert({
    customer_id: full.customer_id,
    customer_name: customer.nome,
    phone: customer.telefone,
    type: "pagamento_confirmado",
    message,
    status: sendOk ? "sent" : "failed",
    error_message: sendError,
  });
}

// ------------------------------------------------------------- criar pix
async function createMpPixPayment(
  customer: any,
  descricao: string,
  valorCentavos: number,
  vencimento: string,
) {
  const cpfClean = String(customer.cpf || "").replace(/\D/g, "");
  const nameParts = String(customer.nome || "Cliente").trim().split(/\s+/);

  // Expira no fim do dia do vencimento (horário de Brasília)
  const expiration = `${vencimento}T23:59:59.000-03:00`;

  const payment = await mpRequest(
    "/v1/payments",
    "POST",
    {
      transaction_amount: Number((valorCentavos / 100).toFixed(2)),
      description: descricao,
      payment_method_id: "pix",
      date_of_expiration: expiration,
      external_reference: `${customer.id}|${vencimento}`,
      payer: {
        email: customer.email || `cliente${cpfClean}@mororo.tech`,
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(" ") || nameParts[0],
        identification: cpfClean ? { type: "CPF", number: cpfClean } : undefined,
      },
    },
    crypto.randomUUID(),
  );

  const tx = payment?.point_of_interaction?.transaction_data || {};
  return {
    payment,
    mp_payment_id: String(payment.id),
    mp_pix_qrcode: tx.qr_code_base64 || null,
    mp_pix_copiacola: tx.qr_code || null,
    mp_link: tx.ticket_url || null,
  };
}

// Garante que uma fatura existente tenha um Pix do Mercado Pago
async function pixForInvoice(req: Request) {
  const supabase = getSupabaseAdmin();
  if (!isInternalCron(req)) {
    await verifyAdmin(req.headers.get("Authorization"));
  }

  const body = await req.json().catch(() => ({}));
  const invoiceId = body?.invoice_id;
  if (!invoiceId) return json({ error: "invoice_id é obrigatório" }, 400);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, customers(*)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return json({ error: "Fatura não encontrada" }, 404);

  if (invoice.mp_pix_copiacola) {
    return json({
      copia_cola: invoice.mp_pix_copiacola,
      qrcode_base64: invoice.mp_pix_qrcode,
      link: invoice.mp_link,
      reused: true,
    });
  }

  const customer = invoice.customers;
  if (!customer) return json({ error: "Cliente da fatura não encontrado" }, 404);

  const created = await createMpPixPayment(
    customer,
    invoice.descricao,
    invoice.valor_centavos,
    invoice.vencimento,
  );

  await supabase
    .from("invoices")
    .update({
      gateway: "mercadopago",
      mp_payment_id: created.mp_payment_id,
      mp_pix_qrcode: created.mp_pix_qrcode,
      mp_pix_copiacola: created.mp_pix_copiacola,
      mp_link: created.mp_link,
    })
    .eq("id", invoice.id);

  return json({
    copia_cola: created.mp_pix_copiacola,
    qrcode_base64: created.mp_pix_qrcode,
    link: created.mp_link,
    reused: false,
  });
}

async function createPix(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const supabase = getSupabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const { customer_id, descricao, valor_centavos, vencimento, plan_id } = body;

  if (!customer_id || !descricao || !valor_centavos || !vencimento) {
    return json(
      { error: "customer_id, descricao, valor_centavos e vencimento são obrigatórios" },
      400,
    );
  }
  if (Number(valor_centavos) < 100) {
    return json({ error: "Valor mínimo é R$ 1,00" }, 400);
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customer_id)
    .single();

  if (!customer) return json({ error: "Cliente não encontrado" }, 404);

  const created = await createMpPixPayment(
    customer,
    descricao,
    valor_centavos,
    vencimento,
  );
  const payment = created.payment;

  const payload = {
    customer_id,
    plan_id: plan_id || null,
    descricao,
    valor_centavos,
    vencimento,
    status: "pending",
    gateway: "mercadopago",
    mp_payment_id: created.mp_payment_id,
    mp_pix_qrcode: created.mp_pix_qrcode,
    mp_pix_copiacola: created.mp_pix_copiacola,
    mp_link: created.mp_link,
  };

  let { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert(payload)
    .select()
    .single();

  if (invErr && invErr.code === "23505") {
    const { data: updated, error: updErr } = await supabase
      .from("invoices")
      .update({
        descricao,
        valor_centavos,
        status: "pending",
        plan_id: plan_id || null,
        gateway: "mercadopago",
        mp_payment_id: payload.mp_payment_id,
        mp_pix_qrcode: payload.mp_pix_qrcode,
        mp_pix_copiacola: payload.mp_pix_copiacola,
        mp_link: payload.mp_link,
      })
      .eq("customer_id", customer_id)
      .eq("vencimento", vencimento)
      .select()
      .single();
    if (updErr) return json({ error: "Erro ao salvar fatura" }, 500);
    invoice = updated;
    invErr = null;
  }

  if (invErr) {
    console.error("DB insert error:", invErr);
    return json({ error: "Erro ao salvar fatura" }, 500);
  }

  return json({ invoice, mercadopago: { id: payment.id, status: payment.status } });
}

// ------------------------------------------------------------- conferir
async function syncPayment(supabase: any, mpPaymentId: string) {
  const payment = await mpRequest(`/v1/payments/${mpPaymentId}`);
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("mp_payment_id", String(mpPaymentId))
    .maybeSingle();

  if (!invoice) return { found: false, status: payment.status };
  const feeCentavos = Math.round((payment.fee_details || []).reduce((sum: number, fee: any) => sum + Number(fee.amount || 0), 0) * 100);
  const netCentavos = payment.transaction_details?.net_received_amount != null
    ? Math.round(Number(payment.transaction_details.net_received_amount) * 100)
    : Math.max(0, invoice.valor_centavos - feeCentavos);
  await supabase.from("invoices").update({
    payment_method: payment.payment_method_id || "pix",
    gateway_fee_centavos: feeCentavos,
    net_amount_centavos: netCentavos,
  }).eq("id", invoice.id);
  if (invoice.status === "paid") return { found: true, status: "paid", changed: false };

  if (payment.status === "approved") {
    const paidAt = payment.date_approved || new Date().toISOString();
    await settleInvoice(supabase, invoice, paidAt);
    return { found: true, status: "paid", changed: true };
  }

  if (["cancelled", "rejected", "refunded"].includes(payment.status)) {
    await supabase
      .from("invoices")
      .update({ status: "canceled" })
      .eq("id", invoice.id);
    return { found: true, status: "canceled", changed: true };
  }

  return { found: true, status: invoice.status, changed: false };
}

async function checkInvoice(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const supabase = getSupabaseAdmin();
  const invoiceId = new URL(req.url).searchParams.get("invoice_id");
  if (!invoiceId) return json({ error: "invoice_id obrigatório" }, 400);

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, mp_payment_id")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return json({ error: "Fatura não encontrada" }, 404);
  if (!invoice.mp_payment_id)
    return json({ error: "Fatura sem cobrança no Mercado Pago" }, 400);

  const result = await syncPayment(supabase, invoice.mp_payment_id);
  return json(result);
}

// ------------------------------------------------- verificação diária
async function bulkCheck(req: Request) {
  if (!isInternalCron(req)) {
    await verifyAdmin(req.headers.get("Authorization"));
  }
  const supabase = getSupabaseAdmin();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, mp_payment_id, status")
    .eq("gateway", "mercadopago")
    .in("status", ["pending", "overdue"])
    .not("mp_payment_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(60);

  let checked = 0;
  let paid = 0;
  for (const invoice of invoices || []) {
    try {
      const result = await syncPayment(supabase, invoice.mp_payment_id!);
      checked++;
      if (result.status === "paid" && result.changed) paid++;
    } catch (err) {
      console.error(`Falha ao verificar fatura ${invoice.id}:`, (err as Error).message);
    }
  }

  return json({ checked, paid, total: invoices?.length || 0 });
}

// ------------------------------------------------------------ webhook
async function handleWebhook(req: Request) {
  const supabase = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);

  const paymentId =
    body?.data?.id ||
    body?.resource?.toString().split("/").pop() ||
    url.searchParams.get("data.id") ||
    url.searchParams.get("id");

  const topic = body?.type || body?.topic || url.searchParams.get("topic");

  if (!paymentId || (topic && !String(topic).includes("payment"))) {
    return json({ received: true, ignored: true });
  }

  try {
    const result = await syncPayment(supabase, String(paymentId));
    console.log("Webhook Mercado Pago:", paymentId, JSON.stringify(result));
  } catch (err) {
    console.error("Webhook Mercado Pago falhou:", (err as Error).message);
  }

  // Mercado Pago exige 200 para não reenviar indefinidamente
  return json({ received: true });
}

async function testConnection(req: Request) {
  await verifyAdmin(req.headers.get("Authorization"));
  const me = await mpRequest("/users/me");
  return json({
    ok: true,
    account: me.nickname || me.email,
    site: me.site_id,
    live_mode: !(await mpToken()).startsWith("TEST-"),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const path = new URL(req.url).pathname.replace(/^\/mercadopago/, "") || "/";

  try {
    if (path === "/webhook") return await handleWebhook(req);
    if (path === "/create") return await createPix(req);
    if (path === "/pix-for-invoice") return await pixForInvoice(req);
    if (path === "/check") return await checkInvoice(req);
    if (path === "/bulk-check") return await bulkCheck(req);
    if (path === "/test") return await testConnection(req);
    return json({ error: "Rota não encontrada" }, 404);
  } catch (err) {
    const message = (err as Error).message || "Erro inesperado";
    const status = message.includes("Unauthorized")
      ? 401
      : message.includes("Forbidden")
        ? 403
        : 500;
    console.error("mercadopago error:", message);
    return json({ error: message }, status);
  }
});
