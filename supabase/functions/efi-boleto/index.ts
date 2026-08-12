import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function isValidCPF(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === parseInt(cpf[10]);
}

// EFI API endpoints (production)
const EFI_BASE_URL = "https://cobrancas.api.efipay.com.br";
const EFI_AUTH_URL = `${EFI_BASE_URL}/v1/authorize`;

async function getEfiToken(): Promise<string> {
  const clientId = Deno.env.get("EFI_CLIENT_ID")!;
  const clientSecret = Deno.env.get("EFI_CLIENT_SECRET")!;
  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(EFI_AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("EFI auth error:", err);
    throw new Error(`EFI auth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function logEfiApiCall(
  supabase: any,
  method: string,
  endpoint: string,
  statusCode: number | null,
  requestBody: string | null,
  responseBody: string | null,
  errorMessage: string | null,
  durationMs: number,
  context: string | null
) {
  try {
    const { error } = await supabase.from("efi_api_logs").insert({
      method,
      endpoint,
      status_code: statusCode,
      request_body: requestBody?.slice(0, 2000),
      response_body: responseBody?.slice(0, 2000),
      error_message: errorMessage?.slice(0, 1000),
      duration_ms: durationMs,
      context,
    });
    if (error) console.error("Error inserting into efi_api_logs:", error);
  } catch (e) {
    console.error("Failed to log EFI API call:", e);
  }
}

async function efiRequest(path: string, method: string, body?: unknown, context?: string) {
  const token = await getEfiToken();

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  const bodyStr = body ? JSON.stringify(body) : null;
  if (bodyStr) options.body = bodyStr;

  const fullUrl = `${EFI_BASE_URL}${path}`;
  console.log("EFI request:", method, fullUrl);

  const startTime = Date.now();
  let response: Response;
  let responseText: string;
  
  try {
    response = await fetch(fullUrl, options);
    responseText = await response.text();
  } catch (fetchErr) {
    const duration = Date.now() - startTime;
    const admin = getSupabaseAdmin();
    await logEfiApiCall(admin, method, path, null, bodyStr, null, fetchErr.message, duration, context || null);
    throw fetchErr;
  }

  const duration = Date.now() - startTime;
  console.log("EFI response:", response.status, responseText.slice(0, 500));

  let data;
  try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

  if (!response.ok) {
    const errMsg = typeof data.error_description === 'object' 
      ? JSON.stringify(data.error_description) 
      : (data.error_description || data.message || `EFI API error: ${response.status}`);
    
    const admin = getSupabaseAdmin();
    await logEfiApiCall(admin, method, path, response.status, bodyStr, responseText.slice(0, 2000), errMsg, duration, context || null);
    
    throw new Error(errMsg);
  }

  return data;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function getSupabaseClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
}

async function verifyAdmin(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const adminClient = getSupabaseAdmin();
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await adminClient.auth.getUser(token);
  
  if (error || !user) {
    console.error("Auth error:", error);
    throw new Error("Unauthorized");
  }
  
  const userId = user.id;
  
  // Check admin role using service role
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

async function createBoleto(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { customer_id, descricao, valor_centavos, vencimento, plan_id } = await req.json();

  const supabase = getSupabaseAdmin();

  // Get customer data
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customer_id)
    .single();

  if (custErr || !customer) {
    return new Response(JSON.stringify({ error: "Cliente não encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate CPF
  const cpfClean = customer.cpf.replace(/\D/g, "");
  if (!isValidCPF(cpfClean)) {
    return new Response(JSON.stringify({ error: `CPF inválido: ${cpfClean}. Corrija o cadastro do cliente antes de gerar boleto.` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Format date for EFI (YYYY-MM-DD)
  const expireAt = vencimento;

  // Check if invoice already exists for this customer+vencimento
  const { data: existingInvoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customer_id)
    .eq("vencimento", expireAt)
    .maybeSingle();

  if (existingInvoice && existingInvoice.efi_charge_id && ["pending", "waiting"].includes(existingInvoice.status)) {
    return new Response(JSON.stringify({ 
      error: `Já existe uma cobrança para este cliente no vencimento ${expireAt}. Cancele a existente antes de gerar uma nova.`,
      existing_invoice_id: existingInvoice.id 
    }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create charge on EFI - one step
  const chargeBody = {
    items: [
      {
        name: descricao,
        value: valor_centavos,
        amount: 1,
      },
    ],
    payment: {
      banking_billet: {
        customer: {
          name: customer.nome,
          cpf: customer.cpf.replace(/\D/g, ""),
          email: customer.email,
          ...(customer.telefone
            ? {
                phone_number: customer.telefone.replace(/\D/g, ""),
              }
            : {}),
        },
        expire_at: expireAt,
        message: `Pagamento referente a: ${descricao}`,
      },
    },
  };

  try {
    console.log("EFI boleto - CPF cliente enviado:", cpfClean, "| Nome:", customer.nome, "| Email:", customer.email);
    const efiResponse = await efiRequest("/v1/charge/one-step", "POST", chargeBody, "criar_boleto");

    const chargeData = efiResponse.data || efiResponse;
    // Log full keys to debug response structure
    console.log("EFI one-step response keys:", JSON.stringify({
      topKeys: Object.keys(chargeData),
      hasPayment: !!chargeData.payment,
      paymentKeys: chargeData.payment ? Object.keys(chargeData.payment) : [],
      hasBankingBillet: !!chargeData.payment?.banking_billet,
      billetKeys: chargeData.payment?.banking_billet ? Object.keys(chargeData.payment.banking_billet) : [],
      directBarcode: chargeData.barcode?.substring(0, 20),
      directLink: chargeData.link?.substring(0, 50),
      directPix: !!chargeData.pix,
    }));
    const billet = chargeData.payment?.banking_billet || chargeData;

    console.log("EFI charge parsed - barcode:", billet.barcode?.substring(0, 20), "pix:", !!billet.pix, "link:", billet.link?.substring(0, 50), "pdf:", billet.pdf);

    // Save invoice to database
    const invoicePayload = {
      customer_id,
      plan_id: plan_id || null,
      descricao,
      valor_centavos,
      vencimento: expireAt,
      status: "pending",
      efi_charge_id: chargeData.charge_id || chargeData.id,
      efi_barcode: billet.barcode || null,
      efi_pix_qrcode: billet.pix?.qrcode || null,
      efi_pix_copiacola: billet.pix?.qrcode || null,
      efi_link: billet.link || billet.pdf?.charge || null,
    };

    let { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert(invoicePayload)
      .select()
      .single();

    // If duplicate key, update the existing invoice instead
    if (invErr && invErr.code === "23505") {
      console.log("Duplicate invoice found, updating existing record");
      const { data: updated, error: updErr } = await supabase
        .from("invoices")
        .update({
          descricao,
          valor_centavos,
          status: "pending",
          plan_id: plan_id || null,
          efi_charge_id: chargeData.charge_id || chargeData.id,
          efi_barcode: billet.barcode || null,
          efi_pix_qrcode: billet.pix?.qrcode || null,
          efi_pix_copiacola: billet.pix?.qrcode || null,
          efi_link: billet.link || billet.pdf?.charge || null,
        })
        .eq("customer_id", customer_id)
        .eq("vencimento", expireAt)
        .select()
        .single();
      
      if (updErr) {
        console.error("DB update error:", updErr);
        return new Response(JSON.stringify({ error: "Erro ao salvar fatura" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      invoice = updated;
      invErr = null;
    }

    if (invErr) {
      console.error("DB insert error:", invErr);
      return new Response(JSON.stringify({ error: "Erro ao salvar fatura" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ invoice, efi: chargeData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("EFI create boleto error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao gerar boleto na EFI" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

async function checkPayment(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("invoice_id");

  if (!invoiceId) {
    return new Response(JSON.stringify({ error: "invoice_id obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (error || !invoice) {
    return new Response(JSON.stringify({ error: "Fatura não encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!invoice.efi_charge_id) {
    return new Response(JSON.stringify({ error: "Fatura sem cobrança EFI" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const efiResponse = await efiRequest(
      `/v1/charge/${invoice.efi_charge_id}`,
      "GET",
      undefined,
      "verificar_pagamento"
    );

    const chargeData = efiResponse.data || efiResponse;
    const efiStatus = chargeData.status;

    // Map EFI status to our status
    let newStatus = invoice.status;
    let paidAt = invoice.paid_at;

    if (efiStatus === "paid" || efiStatus === "settled") {
      newStatus = "paid";
      paidAt = paidAt || new Date().toISOString();
    } else if (efiStatus === "canceled" || efiStatus === "refunded") {
      newStatus = "cancelled";
    } else if (efiStatus === "expired" || efiStatus === "unpaid") {
      newStatus = "overdue";
    }

    // Extract billet data if available - EFI GET returns it inside payment.banking_billet
    const billet = chargeData.payment?.banking_billet || {};
    console.log("checkPayment billet data:", JSON.stringify({ 
      has_payment: !!chargeData.payment, 
      has_banking_billet: !!chargeData.payment?.banking_billet,
      barcode: billet.barcode?.substring(0, 20),
      link: billet.link?.substring(0, 50),
      pix: !!billet.pix,
    }));
    const updatePayload: Record<string, any> = { status: newStatus, paid_at: paidAt };
    
    // Fill in missing billet data
    if (billet.barcode && !invoice.efi_barcode) updatePayload.efi_barcode = billet.barcode;
    if (billet.pix?.qrcode && !invoice.efi_pix_qrcode) updatePayload.efi_pix_qrcode = billet.pix.qrcode;
    if (billet.pix?.qrcode && !invoice.efi_pix_copiacola) updatePayload.efi_pix_copiacola = billet.pix.qrcode;
    if ((billet.link || billet.pdf?.charge) && !invoice.efi_link) updatePayload.efi_link = billet.link || billet.pdf?.charge;
    
    // Force update if we have new billet data
    const hasBilletUpdates = Object.keys(updatePayload).length > 2;

    // Update invoice
    if (newStatus !== invoice.status || hasBilletUpdates) {
      await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", invoiceId);

      // Send notification if newly paid
      if (newStatus === "paid" && invoice.status !== "paid") {
        await sendPaymentNotification(supabase, invoiceId);
      }
    }

    return new Response(
      JSON.stringify({
        invoice_id: invoiceId,
        status: newStatus,
        efi_status: efiStatus,
        efi_data: chargeData,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("EFI check payment error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao verificar pagamento" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

async function importFromEfi(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const url = new URL(req.url);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const userBegin = url.searchParams.get("begin_date") || "2020-01-01";
  const userEnd = url.searchParams.get("end_date") || todayStr;

  const supabase = getSupabaseAdmin();

  try {
    // EFI limits date range to 1 year max, so chunk by year
    let allCharges: any[] = [];
    let chunkStart = new Date(userBegin + "T00:00:00");
    const finalEnd = new Date(userEnd + "T00:00:00");

    while (chunkStart <= finalEnd) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
      chunkEnd.setDate(chunkEnd.getDate() - 1); // max 364 days
      const effectiveEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;

      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const bd = fmt(chunkStart);
      const ed = fmt(effectiveEnd);

      let offset = 0;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const charges = await efiRequest(
          `/v1/charges?charge_type=billet&begin_date=${bd}&end_date=${ed}&limit=${limit}&offset=${offset}`,
          "GET"
        );
        const page = charges.data || charges || [];
        if (Array.isArray(page)) {
          allCharges = allCharges.concat(page);
          hasMore = page.length === limit;
        } else {
          hasMore = false;
        }
        offset += limit;
      }

      chunkStart = new Date(effectiveEnd);
      chunkStart.setDate(chunkStart.getDate() + 1);
    }

    const chargeList = allCharges;
    let importedCustomers = 0;
    let importedInvoices = 0;
    let skippedInvoices = 0;

    for (const charge of chargeList) {
      const customer = charge.customer || charge.payment?.banking_billet?.customer;
      if (!customer) continue;

      const cpf = (customer.cpf || "").replace(/\D/g, "");
      if (!cpf) continue;

      // Try to find or create customer
      let { data: existingCustomer } = await supabase
        .from("customers")
        .select("id")
        .eq("cpf", cpf)
        .maybeSingle();

      if (!existingCustomer) {
        const phone = customer.phone_number || customer.phone || null;
        const { data: newCust, error: custErr } = await supabase
          .from("customers")
          .insert({
            nome: customer.name || "Sem nome",
            cpf,
            email: customer.email || `${cpf}@importado.efi`,
            telefone: phone,
            usuario_pppoe: `pppoe_${cpf}`,
            senha_pppoe: "importado",
          })
          .select("id")
          .single();

        if (custErr) {
          console.error("Import customer error:", custErr);
          continue;
        }
        existingCustomer = newCust;
        importedCustomers++;
      }

      // Check if charge already imported
      const chargeId = charge.charge_id || charge.id;
      const { data: existingInvoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("efi_charge_id", chargeId)
        .maybeSingle();

      if (existingInvoice) {
        skippedInvoices++;
        continue;
      }

      // Map EFI status
      let status = "pending";
      if (charge.status === "paid" || charge.status === "settled") status = "paid";
      else if (charge.status === "canceled" || charge.status === "refunded") status = "cancelled";
      else if (charge.status === "expired" || charge.status === "unpaid") status = "overdue";

      const billet = charge.payment?.banking_billet || {};
      const value = charge.value || charge.total || billet.value || 0;

      const { error: invErr } = await supabase.from("invoices").insert({
        customer_id: existingCustomer!.id,
        descricao: charge.message || charge.custom_id || `Cobrança EFI #${chargeId}`,
        valor_centavos: value,
        vencimento: billet.expire_at || charge.expire_at || charge.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        status,
        efi_charge_id: chargeId,
        efi_barcode: billet.barcode || null,
        efi_link: billet.link || billet.pdf?.charge || null,
        paid_at: status === "paid" ? (charge.paid_at || new Date().toISOString()) : null,
      });

      if (invErr) {
        console.error("Import invoice error:", invErr);
      } else {
        importedInvoices++;
      }
    }

    return new Response(
      JSON.stringify({
        total_charges: chargeList.length,
        imported_customers: importedCustomers,
        imported_invoices: importedInvoices,
        skipped_invoices: skippedInvoices,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Import error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao importar da EFI" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function cancelCharge(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const { charge_id } = await req.json();
  if (!charge_id) {
    return new Response(JSON.stringify({ error: "charge_id obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await efiRequest(`/v1/charge/${charge_id}/cancel`, "PUT", undefined, "cancelar_cobranca");
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("EFI cancel error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao cancelar na EFI" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function checkCustomerCharges(req: Request) {
  const authHeader = req.headers.get("Authorization");
  await verifyAdmin(authHeader);

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customer_id");
  if (!customerId) {
    return new Response(JSON.stringify({ error: "customer_id obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (custErr || !customer) {
    return new Response(JSON.stringify({ error: "Cliente não encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cpf = customer.cpf.replace(/\D/g, "");

  try {
    // Search charges by CPF on EFI using customer_document filter
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    let allCharges: any[] = [];

    // Search both billets and carnets via /v1/charges with customer_document filter
    const chargeTypes = ["billet", "carnet"];

    for (const chargeType of chargeTypes) {
      let chunkStart = new Date("2020-01-01T00:00:00");
      const finalEnd = new Date(todayStr + "T00:00:00");

      while (chunkStart <= finalEnd) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        const effectiveEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd;

        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const bd = fmt(chunkStart);
        const ed = fmt(effectiveEnd);

        let offset = 0;
        const limit = 100;
        let hasMore = true;
        while (hasMore) {
          try {
            const charges = await efiRequest(
              `/v1/charges?charge_type=${chargeType}&customer_document=${cpf}&begin_date=${bd}&end_date=${ed}&limit=${limit}&offset=${offset}`,
              "GET"
            );
            const page = charges.data || charges || [];
            if (Array.isArray(page)) {
              allCharges = allCharges.concat(page);
              hasMore = page.length === limit;
            } else {
              hasMore = false;
            }
          } catch (e) {
            console.error(`Error fetching ${chargeType} charges:`, e);
            hasMore = false;
          }
          offset += limit;
        }

        chunkStart = new Date(effectiveEnd);
        chunkStart.setDate(chunkStart.getDate() + 1);
      }
    }

    // Import found charges
    let imported = 0;
    let skipped = 0;

    for (const charge of allCharges) {
      const chargeId = charge.charge_id || charge.id;
      if (!chargeId) continue;

      // Check if already imported
      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("efi_charge_id", chargeId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      let status = "pending";
      if (charge.status === "paid" || charge.status === "settled") status = "paid";
      else if (charge.status === "canceled" || charge.status === "refunded") status = "cancelled";
      else if (charge.status === "expired" || charge.status === "unpaid") status = "overdue";

      const billet = charge.payment?.banking_billet || {};
      const value = charge.value || charge.total || billet.value || 0;

      const { error: invErr } = await supabase.from("invoices").insert({
        customer_id: customer.id,
        descricao: charge.message || charge.custom_id || `Cobrança EFI #${chargeId}`,
        valor_centavos: value,
        vencimento: billet.expire_at || charge.expire_at || charge.created_at?.slice(0, 10) || now.toISOString().slice(0, 10),
        status,
        efi_charge_id: chargeId,
        efi_barcode: billet.barcode || null,
        efi_link: billet.link || billet.pdf?.charge || null,
        paid_at: status === "paid" ? (charge.paid_at || now.toISOString()) : null,
      });

      if (invErr) {
        console.error("Import invoice error:", invErr);
      } else {
        imported++;
      }
    }

    return new Response(
      JSON.stringify({
        cpf,
        customer_name: customer.nome,
        total_found: allCharges.length,
        imported,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Check customer charges error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro ao consultar cobranças na EFI" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

async function sendPaymentNotification(supabase: any, invoiceId: string) {
  try {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("*, customers(*)")
      .eq("id", invoiceId)
      .single();

    if (!invoice) return;
    const customer = (invoice as any).customers;

    // --- Automatic Unblock Logic ---
    if (customer && customer.block_status === 'blocked') {
      const today = new Date().toISOString().split('T')[0];
      const { count: overdueCount } = await supabase
        .from("invoices")
        .select("id", { count: 'exact', head: true })
        .eq("customer_id", customer.id)
        .in("status", ["pending", "overdue"])
        .lt("vencimento", today)
        .neq("id", invoiceId); // Exclude the current invoice which just got paid

      if (overdueCount === 0) {
        console.log(`[Unblock] Customer ${customer.nome} has no other overdue invoices. Unblocking...`);
        
        // Update DB status
        await supabase
          .from("customers")
          .update({ block_status: "active" })
          .eq("id", customer.id);

        // Audit log
        await supabase.from("block_history").insert({
          customer_id: customer.id,
          old_status: "blocked",
          new_status: "active",
          reason: "Desbloqueio automático: pagamento realizado e sem outras pendências vencidas",
          changed_by: null // System action
        });

        // Trigger Mikrotik unblock via edge function
        try {
          const { error: syncErr } = await supabase.functions.invoke("mikrotik-customer", {
            body: { customer_id: customer.id, action: "enable" }
          });
          if (syncErr) console.error("[Unblock] Mikrotik sync error:", syncErr);
        } catch (e) {
          console.error("[Unblock] Failed to invoke mikrotik-customer:", e);
        }
      }
    }
    // --- End Unblock Logic ---

    if (!customer?.telefone) {
      // Log even if no phone
      await supabase.from("notification_logs").insert({
        customer_id: invoice.customer_id,
        customer_name: customer?.nome || "Desconhecido",
        phone: null,
        type: "pagamento_confirmado",
        message: `Pagamento confirmado: ${invoice.descricao}`,
        status: "failed",
        error_message: "Cliente sem telefone cadastrado",
      });
      return;
    }

    const valor = (invoice.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const message = `Olá ${customer.nome}! 🌐\n\n✅ Pagamento confirmado!\n\n📋 ${invoice.descricao}\n💰 Valor: ${valor}\n\nObrigado por manter sua internet em dia! 🚀`;

    const UAZAPI_BASE_URL = "https://ipazua.uazapi.com";
    let token = "";
    const { data: tokenData } = await supabase.from("settings").select("value").eq("key", "uazapi_token").maybeSingle();
    token = tokenData?.value || Deno.env.get("UAZAPI_TOKEN") || "";

    if (!token) {
      await supabase.from("notification_logs").insert({
        customer_id: invoice.customer_id,
        customer_name: customer.nome,
        phone: customer.telefone,
        type: "pagamento_confirmado",
        message,
        status: "failed",
        error_message: "Token WhatsApp não configurado",
      });
      return;
    }

    let digits = customer.telefone.replace(/\D/g, "");
    if (!digits.startsWith("55")) digits = "55" + digits;

    const response = await fetch(`${UAZAPI_BASE_URL}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: digits, text: message }),
    });

    const responseText = await response.text();
    console.log("Payment notification sent:", response.status, responseText.slice(0, 200));

    await supabase.from("notification_logs").insert({
      customer_id: invoice.customer_id,
      customer_name: customer.nome,
      phone: customer.telefone,
      type: "pagamento_confirmado",
      message,
      status: response.ok ? "sent" : "failed",
      error_message: response.ok ? null : responseText.slice(0, 500),
    });
  } catch (err) {
    console.error("Payment notification error:", err);
  }
}

async function bulkCheckPayments(req: Request) {
  const authHeader = req.headers.get("Authorization");
  // Check if it's a cron job (via service role key) or a logged-in admin
  if (authHeader) {
    try {
      await verifyAdmin(authHeader);
    } catch (e) {
      // If it's not an admin, check if it's the service role key (cron)
      const token = authHeader.replace("Bearer ", "");
      if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        throw e;
      }
    }
  }

  const supabase = getSupabaseAdmin();

  // ===== PASS 1: Reconcile invoices WITHOUT efi_charge_id by querying EFI by CPF =====
  // Lists open invoices per customer, fetches the customer's recent EFI charges, and
  // links/updates each one matched by month of vencimento + valor.
  let reconciled = 0;
  try {
    const { data: orphanInvoices } = await supabase
      .from("invoices")
      .select("id, customer_id, valor_centavos, vencimento, status, customers(cpf)")
      .in("status", ["pending", "waiting", "overdue"])
      .is("efi_charge_id", null)
      .order('vencimento', { ascending: false })
      .limit(15);


    // Group by customer CPF
    const byCpf = new Map<string, { customer_id: string; invoices: any[] }>();
    for (const inv of orphanInvoices || []) {
      const cpf = ((inv as any).customers?.cpf || "").replace(/\D/g, "");
      if (!cpf) continue;
      if (!byCpf.has(cpf)) byCpf.set(cpf, { customer_id: inv.customer_id, invoices: [] });
      byCpf.get(cpf)!.invoices.push(inv);
    }

    const now = new Date();
    const beginDate = new Date(now); beginDate.setFullYear(beginDate.getFullYear() - 1); // 12 months for better coverage
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const bd = fmt(beginDate);
    const ed = fmt(now);

    for (const [cpf, group] of byCpf) {
      try {
        let charges: any[] = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;
        while (hasMore) {
          const resp = await efiRequest(
            `/v1/charges?charge_type=billet&customer_document=${cpf}&begin_date=${bd}&end_date=${ed}&limit=${limit}&offset=${offset}`,
            "GET", undefined, "bulk_check"
          );
          const page = resp.data || resp || [];
          if (Array.isArray(page)) {
            charges = charges.concat(page);
            hasMore = page.length === limit;
          } else { hasMore = false; }
          offset += limit;
        }

        for (const inv of group.invoices) {
          const invMonth = String(inv.vencimento).slice(0, 7); // YYYY-MM
          const match = charges.find((c: any) => {
            const billet = c.payment?.banking_billet || {};
            const expire = billet.expire_at || c.expire_at || c.created_at?.slice(0, 10) || "";
            const sameMonth = String(expire).slice(0, 7) === invMonth;
            const value = c.value || c.total || billet.value || 0;
            const diffPercent = Math.abs(Number(value) - Number(inv.valor_centavos)) / Number(inv.valor_centavos);
            return sameMonth && diffPercent < 0.05; // 5% margin for fines/interest
          });
          if (!match) continue;

          const chargeId = match.charge_id || match.id;
          const billet = match.payment?.banking_billet || {};
          let newStatus = inv.status;
          let paidAt: string | null = inv.paid_at;
          if (match.status === "paid" || match.status === "settled") {
            newStatus = "paid"; 
            paidAt = match.paid_at || new Date().toISOString();
          } else if (match.status === "link" || match.status === "active") {
            newStatus = "pending";
          } else if (match.status === "canceled" || match.status === "refunded") {
            newStatus = "cancelled";
          } else if (match.status === "expired" || match.status === "unpaid") {
            newStatus = "overdue";
          }
          await supabase.from("invoices").update({
            efi_charge_id: chargeId,
            efi_barcode: billet.barcode || null,
            efi_link: billet.link || billet.pdf?.charge || null,
            status: newStatus,
            paid_at: paidAt,
          }).eq("id", inv.id);
          reconciled++;
          
          // Send notification if newly paid during reconciliation
          if (newStatus === "paid" && inv.status !== "paid") {
             try { await sendPaymentNotification(supabase, inv.id); } catch (e) { console.error("Notification error:", e); }
          }
        }
      } catch (e) {
        console.error(`reconcile by cpf ${cpf} failed:`, e);
      }
      await new Promise(r => setTimeout(r, 200));
    }


    // ===== PASS 1.5: Deep Reconciliation for Overdue Orphans =====
    try {
    const { data: overdueOrphans } = await supabase
        .from("invoices")
        .select("id, customer_id, valor_centavos, vencimento, status, customers(cpf)")
        .eq("status", "overdue")
        .is("efi_charge_id", null)
        .order('vencimento', { ascending: false })
        .limit(10);


      if (overdueOrphans && overdueOrphans.length > 0) {
        console.log(`Deep reconciliation for ${overdueOrphans.length} overdue orphans...`);
        const byCpf = new Map<string, any[]>();
        for (const inv of overdueOrphans) {
          const cpf = ((inv as any).customers?.cpf || "").replace(/\D/g, "");
          if (cpf) {
            if (!byCpf.has(cpf)) byCpf.set(cpf, []);
            byCpf.get(cpf)!.push(inv);
          }
        }

        const longAgo = new Date();
        longAgo.setFullYear(longAgo.getFullYear() - 2); 
        const bdDeep = fmt(longAgo);
        const edDeep = fmt(now);

        for (const [cpf, group] of byCpf) {
          try {
            let charges: any[] = [];
            let offset = 0;
            const limit = 100;
            let hasMore = true;
            while (hasMore) {
              const resp = await efiRequest(
                `/v1/charges?charge_type=billet&customer_document=${cpf}&begin_date=${bdDeep}&end_date=${edDeep}&limit=${limit}&offset=${offset}`,
                "GET", undefined, "bulk_check_deep"
              );
              const page = resp.data || resp || [];
              if (Array.isArray(page)) {
                charges = charges.concat(page);
                hasMore = page.length === limit;
              } else { hasMore = false; }
              offset += limit;
            }

            for (const inv of group) {
              const invMonth = String(inv.vencimento).slice(0, 7);
              const match = charges.find((c: any) => {
                const billet = c.payment?.banking_billet || {};
                const expire = billet.expire_at || c.expire_at || c.created_at?.slice(0, 10) || "";
                const sameMonth = String(expire).slice(0, 7) === invMonth;
                const value = c.value || c.total || billet.value || 0;
                const diffPercent = Math.abs(Number(value) - Number(inv.valor_centavos)) / Number(inv.valor_centavos);
                return sameMonth && diffPercent < 0.08;
              });

              if (match) {
                const chargeId = match.charge_id || match.id;
                const billet = match.payment?.banking_billet || {};
                let newStatus = inv.status;
                let paidAt: string | null = inv.paid_at;
                
                if (match.status === "paid" || match.status === "settled") {
                  newStatus = "paid"; 
                  paidAt = match.paid_at || new Date().toISOString();
                } else if (match.status === "link" || match.status === "active") {
                  newStatus = "pending";
                } else if (match.status === "canceled" || match.status === "refunded") {
                  newStatus = "cancelled";
                }

                await supabase.from("invoices").update({
                  efi_charge_id: chargeId,
                  efi_barcode: billet.barcode || null,
                  efi_link: billet.link || billet.pdf?.charge || null,
                  status: newStatus,
                  paid_at: paidAt,
                }).eq("id", inv.id);
                reconciled++;
                if (newStatus === "paid") {
                   try { await sendPaymentNotification(supabase, inv.id); } catch (e) { /* silent */ }
                }
              }
            }
          } catch (e) { console.error(`Deep search for CPF ${cpf} failed:`, e); }
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } catch (e) { console.error("Deep reconciliation pass failed:", e); }

  } catch (e) {
    console.error("Reconcile pass failed:", e);
  }

  // ===== PASS 2: Refresh invoices that already have an efi_charge_id =====
  const { data: pendingInvoices, error } = await supabase
    .from("invoices")
    .select("id, efi_charge_id, status, paid_at, efi_barcode, efi_link, efi_pix_qrcode, efi_pix_copiacola")
    .in("status", ["pending", "waiting", "overdue"])
    .not("efi_charge_id", "is", null)
    .order('vencimento', { ascending: false })
    .limit(30);

  if (error) {
    return new Response(JSON.stringify({ error: "Erro ao buscar faturas" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!pendingInvoices || pendingInvoices.length === 0) {
    return new Response(JSON.stringify({ checked: 0, updated: 0, reconciled, message: "No pending invoices found for pass 2" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let updated = 0;
  let errors = 0;
  const paidInvoiceIds: string[] = [];


  for (const inv of pendingInvoices) {
    try {
      const efiResponse = await efiRequest(`/v1/charge/${inv.efi_charge_id}`, "GET", undefined, "bulk_check");
      const chargeData = efiResponse.data || efiResponse;
      const efiStatus = chargeData.status;

      let newStatus = inv.status;
      let paidAt = inv.paid_at;

      if (efiStatus === "paid" || efiStatus === "settled") {
        newStatus = "paid";
        paidAt = paidAt || new Date().toISOString();
      } else if (efiStatus === "link" || efiStatus === "active") {
        // Just link/active, not necessarily paid yet
        newStatus = "pending";
      } else if (efiStatus === "canceled" || efiStatus === "refunded") {
        newStatus = "cancelled";
      } else if (efiStatus === "expired" || efiStatus === "unpaid") {
        newStatus = "overdue";
      }

      // Extract billet data (link, barcode, pix)
      const billet = chargeData.payment?.banking_billet || {};
      const updatePayload: Record<string, any> = { status: newStatus, paid_at: paidAt };
      
      if (billet.barcode && !inv.efi_barcode) updatePayload.efi_barcode = billet.barcode;
      if (billet.pix?.qrcode && !inv.efi_pix_qrcode) updatePayload.efi_pix_qrcode = billet.pix.qrcode;
      if (billet.pix?.qrcode && !inv.efi_pix_copiacola) updatePayload.efi_pix_copiacola = billet.pix.qrcode;
      if ((billet.link || billet.pdf?.charge) && !inv.efi_link) updatePayload.efi_link = billet.link || billet.pdf?.charge;

      const hasBilletUpdates = Object.keys(updatePayload).length > 2;

      if (newStatus !== inv.status || hasBilletUpdates) {
        await supabase
          .from("invoices")
          .update(updatePayload)
          .eq("id", inv.id);
        updated++;

        // Track paid invoices for notification
        if (newStatus === "paid") {
          paidInvoiceIds.push(inv.id);
        }
      }
    } catch (e) {
      console.error(`Error checking charge ${inv.efi_charge_id}:`, e);
      errors++;
    }
  }

  // Send WhatsApp notifications for newly paid invoices (best-effort, must not fail the response)
  for (const invoiceId of paidInvoiceIds) {
    try {
      await sendPaymentNotification(supabase, invoiceId);
    } catch (e) {
      console.error("sendPaymentNotification failed:", e);
    }
  }

  return new Response(
    JSON.stringify({ checked: pendingInvoices.length, updated, errors, notified: paidInvoiceIds.length, reconciled }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    switch (path) {
      case "create":
        return await createBoleto(req);
      case "check":
        return await checkPayment(req);
      case "bulk-check": {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
          return new Response(JSON.stringify({ error: "Missing authorization header" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return await bulkCheckPayments(req);
      }
      case "import":
        return await importFromEfi(req);
      case "cancel":
        return await cancelCharge(req);
      case "check-customer":
        return await checkCustomerCharges(req);
      case "test": {
        const authHeader = req.headers.get("Authorization");
        await verifyAdmin(authHeader);
        try {
          const token = await getEfiToken();
          return new Response(JSON.stringify({ success: true, message: "Conexão com a EFI estabelecida com sucesso!", token_preview: token.slice(0, 10) + "..." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message || "Falha ao conectar com a EFI" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      default:
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("Edge function error:", err);
    const status = err.message === "Unauthorized" ? 401 : err.message?.includes("Forbidden") ? 403 : 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
