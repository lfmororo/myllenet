import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function decodeBase64(encoded: string): string {
  try {
    return atob(encoded);
  } catch {
    return encoded;
  }
}

function toBase64(str: string): string {
  // Handle UTF-8 properly by encoding bytes first
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

async function loginR3005G(
  baseUrl: string,
  username: string,
  password: string
): Promise<string> {
  const csrfprotect = Math.floor(Date.now() / 1000).toString();
  const tm = Date.now() / 1000;

  const userB64 = toBase64(username);
  const passB64 = toBase64(password);

  // Debug: log first 4 chars of encoded values to verify encoding
  console.log("R3005G debug - user length:", username.length, "user_b64_prefix:", userB64.substring(0, 6));
  console.log("R3005G debug - pass length:", password.length, "pass_b64_prefix:", passB64.substring(0, 6));

  const payload = {
    csrfprotect,
    user: userB64,
    password: passB64,
    tm,
    base64: 1,
  };

  // Try with csrfprotect as query param (Intelbras firmware pattern)
  const loginUrl = `${baseUrl}/log_in.cgi?csrfprotect=${csrfprotect}`;
  console.log("R3005G login to:", loginUrl);

  const res = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Accept": "application/json, text/plain, */*",
      "Origin": baseUrl,
      "Referer": `${baseUrl}/login.html`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  console.log("R3005G login response:", res.status, body);

  let json: { code: number; error?: string; data?: unknown };
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Login parse error. Status: ${res.status}, Body: ${body}`);
  }

  if (json.code !== 0) {
    throw new Error(`Login failed: ${json.error || body}`);
  }

  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : "";
  console.log("R3005G login success, cookie:", cookie ? "present" : "none");
  return cookie;
}

async function fetchPPPoEUsers(
  baseUrl: string,
  cookie: string
): Promise<Array<{ user: string; pwd: string; cstate: number; gid: number }>> {
  const res = await fetch(`${baseUrl}/user.data`, {
    headers: { Cookie: cookie },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch users: ${res.status} - ${text}`);
  }

  const json = await res.json();
  if (json.code !== 0 || !json.data?.all) {
    throw new Error(`Unexpected response: ${JSON.stringify(json)}`);
  }

  return json.data.all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("R3005G_URL");
    const routerUser = Deno.env.get("R3005G_USERNAME");
    const routerPass = Deno.env.get("R3005G_PASSWORD");

    if (!baseUrl || !routerUser || !routerPass) {
      return new Response(
        JSON.stringify({ error: "R3005G credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    // Login to router
    const cookie = await loginR3005G(baseUrl, routerUser, routerPass);

    // Fetch PPPoE users
    const routerUsers = await fetchPPPoEUsers(baseUrl, cookie);

    // Decode usernames
    const decodedUsers = routerUsers.map((u) => ({
      usuario_pppoe: decodeBase64(u.user),
      senha_pppoe: decodeBase64(u.pwd),
      cstate: u.cstate,
      gid: u.gid,
      connected: u.cstate === 97, // 97 = connected
    }));

    if (action === "status") {
      // Just return status - match with existing customers
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: customers } = await serviceClient
        .from("customers")
        .select("id, nome, usuario_pppoe, ativo");

      const statusMap = new Map(
        decodedUsers.map((u) => [u.usuario_pppoe.toLowerCase(), u])
      );

      const result = (customers || []).map((c) => {
        const routerInfo = statusMap.get(c.usuario_pppoe?.toLowerCase());
        return {
          id: c.id,
          nome: c.nome,
          usuario_pppoe: c.usuario_pppoe,
          ativo: c.ativo,
          online: routerInfo?.connected ?? false,
          found_in_router: !!routerInfo,
        };
      });

      // Also find users in router but not in system
      const customerUsernames = new Set(
        (customers || []).map((c) => c.usuario_pppoe?.toLowerCase())
      );
      const notInSystem = decodedUsers
        .filter((u) => !customerUsernames.has(u.usuario_pppoe.toLowerCase()))
        .map((u) => ({
          usuario_pppoe: u.usuario_pppoe,
          senha_pppoe: u.senha_pppoe,
          online: u.connected,
        }));

      return new Response(
        JSON.stringify({
          customers: result,
          not_in_system: notInSystem,
          total_router_users: decodedUsers.length,
          total_connected: decodedUsers.filter((u) => u.connected).length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "import") {
      // Import users not yet in system
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: customers } = await serviceClient
        .from("customers")
        .select("usuario_pppoe");

      const existing = new Set(
        (customers || []).map((c) => c.usuario_pppoe?.toLowerCase())
      );

      const toImport = decodedUsers.filter(
        (u) => !existing.has(u.usuario_pppoe.toLowerCase())
      );

      let imported = 0;
      let failed = 0;

      for (const u of toImport) {
        const { error } = await serviceClient.from("customers").insert({
          nome: u.usuario_pppoe,
          usuario_pppoe: u.usuario_pppoe,
          senha_pppoe: u.senha_pppoe,
          cpf: "000.000.000-00",
          email: `${u.usuario_pppoe}@pendente.com`,
          ativo: u.connected,
        });
        if (error) {
          console.error("Import error:", error);
          failed++;
        } else {
          imported++;
        }
      }

      return new Response(
        JSON.stringify({ imported, failed, skipped: existing.size }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use /status or /import" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("R3005G sync error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
