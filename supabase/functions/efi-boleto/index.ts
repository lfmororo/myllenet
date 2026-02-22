import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

async function efiRequest(path: string, method: string, body?: unknown) {
  const token = await getEfiToken();

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) options.body = JSON.stringify(body);

  const fullUrl = `${EFI_BASE_URL}${path}`;
  console.log("EFI request:", method, fullUrl);

  const response = await fetch(fullUrl, options);
  const responseText = await response.text();
  console.log("EFI response:", response.status, responseText.slice(0, 500));

  let data;
  try { data = JSON.parse(responseText); } catch { data = { raw: responseText }; }

  if (!response.ok) {
    const errMsg = typeof data.error_description === 'object' 
      ? JSON.stringify(data.error_description) 
      : (data.error_description || data.message || `EFI API error: ${response.status}`);
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
  const supabase = getSupabaseClient(authHeader);
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) throw new Error("Unauthorized");
  
  const userId = data.claims.sub as string;
  
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

  // Format date for EFI (YYYY-MM-DD)
  const expireAt = vencimento;

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
    const efiResponse = await efiRequest("/v1/charge/one-step", "POST", chargeBody);

    const chargeData = efiResponse.data || efiResponse;
    const billet = chargeData.payment?.banking_billet || chargeData.banking_billet || {};

    // Save invoice to database
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        customer_id,
        plan_id: plan_id || null,
        descricao,
        valor_centavos,
        vencimento: expireAt,
        status: "pending",
        efi_charge_id: chargeData.charge_id || chargeData.id,
        efi_barcode: billet.barcode,
        efi_pix_qrcode: billet.pix?.qrcode,
        efi_pix_copiacola: billet.pix?.qrcode_image,
        efi_link: billet.link || billet.pdf?.charge,
      })
      .select()
      .single();

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
      "GET"
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

    // Update invoice
    if (newStatus !== invoice.status) {
      await supabase
        .from("invoices")
        .update({ status: newStatus, paid_at: paidAt })
        .eq("id", invoiceId);
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
      case "import":
        return await importFromEfi(req);
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
