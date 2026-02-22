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
  const certBase64 = Deno.env.get("EFI_CERTIFICATE_BASE64")!;

  // Decode the p12 certificate
  const certBytes = Uint8Array.from(atob(certBase64), (c) => c.charCodeAt(0));

  // For Deno, we use the native TLS with the certificate
  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(EFI_AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
    // @ts-ignore - Deno specific TLS options
    client: Deno.createHttpClient({
      caCerts: [],
      certChain: undefined,
      privateKey: undefined,
      // Use the p12 cert
      cert: certBytes,
    }),
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
  const certBase64 = Deno.env.get("EFI_CERTIFICATE_BASE64")!;
  const certBytes = Uint8Array.from(atob(certBase64), (c) => c.charCodeAt(0));

  const options: RequestInit & { client?: unknown } = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // @ts-ignore
    client: Deno.createHttpClient({
      cert: certBytes,
    }),
  };

  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${EFI_BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    console.error("EFI API error:", JSON.stringify(data));
    throw new Error(data.message || `EFI API error: ${response.status}`);
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
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
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
