import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function fromBase64(b64: string): string {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return b64;
  }
}

function getRandomString(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function encodeCredential(input: string): string {
  const randomPrefix = getRandomString(10);
  let shifted = "";
  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);
    shifted += String.fromCharCode(i % 2 === 0 ? charCode + 2 : charCode - 2);
  }
  const combined = randomPrefix + shifted;
  const bytes = new TextEncoder().encode(combined);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function getRouterInfo(baseUrl: string): Promise<{ csrfprotect: string; captchaActive: boolean }> {
  let csrfprotect = Math.floor(Date.now() / 1000).toString();
  let captchaActive = false;
  try {
    const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
    const csrfJson = await csrfRes.json();
    if (csrfJson?.data?.csrfprotect) {
      csrfprotect = csrfJson.data.csrfprotect;
    }
    if (csrfJson?.data?.code?.key && csrfJson.data.code.key !== "") {
      captchaActive = true;
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch csrfprotect.data:", e);
  }
  return { csrfprotect, captchaActive };
}

async function loginR3005G(baseUrl: string, plainUser: string, plainPass: string): Promise<string> {
  const { csrfprotect, captchaActive } = await getRouterInfo(baseUrl);
  if (captchaActive) {
    throw new Error("Router captcha ativo. Aguarde alguns minutos ou faça login manual no navegador.");
  }

  const payload = {
    csrfprotect,
    user: encodeCredential(plainUser),
    password: encodeCredential(plainPass),
    base64: 1,
    tm: Date.now() / 1000,
  };

  const res = await fetch(`${baseUrl}/log_in.cgi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Origin: baseUrl,
      Referer: `${baseUrl}/login.html`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  let json: { code: number; error?: string };
  try { json = JSON.parse(body); } catch { throw new Error(`Login non-JSON: ${body.substring(0, 200)}`); }

  if (json.code === 0) {
    const setCookie = res.headers.get("set-cookie");
    return setCookie ? setCookie.split(";")[0] : "";
  }
  throw new Error(`Login falhou: ${json.error || JSON.stringify(json)}`);
}

// Try many endpoints to find one that returns plain-text PPPoE usernames or online sessions
async function discoverEndpoints(baseUrl: string, cookie: string): Promise<Record<string, unknown>> {
  const endpoints = [
    "user.data",
    "pppoe_online.data",
    "online.data",
    "pppoeUser.data",
    "pppoe_user.data",
    "authenticationUser.data",
    "authentication_user.data",
    "pppoe_server.data",
    "pppoeOnline.data",
    "online_user.data",
    "onlineUser.data",
    "pppoeStatus.data",
    "status.data",
    "pppoe.data",
  ];

  const results: Record<string, unknown> = {};

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}/${ep}`, {
        headers: { Cookie: cookie },
      });
      if (res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          // Only include if it has useful data
          if (json.code === 0 && json.data) {
            // If data is a string, try base64 decode
            let data = json.data;
            if (typeof data === "string") {
              try { data = JSON.parse(fromBase64(data)); } catch { /* keep as is */ }
            }
            results[ep] = {
              type: typeof data,
              keys: typeof data === "object" && data ? Object.keys(data).slice(0, 20) : null,
              sample: JSON.stringify(data).substring(0, 300),
            };
          }
        } catch { /* skip non-JSON */ }
      }
    } catch { /* skip failed */ }
  }

  return results;
}

// Fetch raw user data and log ALL fields
async function fetchRawUsers(baseUrl: string, cookie: string): Promise<{ users: Record<string, unknown>[]; rawSample: string }> {
  const res = await fetch(`${baseUrl}/user.data`, {
    headers: { Cookie: cookie },
  });

  if (!res.ok) throw new Error(`user.data failed: ${res.status}`);

  const json = await res.json();
  let userData = json.data;
  if (typeof json.data === "string") {
    try { userData = JSON.parse(fromBase64(json.data)); } catch { /* keep */ }
  }

  const users = userData?.all || userData?.list || (Array.isArray(userData) ? userData : []);

  // Log ALL fields of first 3 users (no truncation)
  const rawSample = JSON.stringify(users.slice(0, 3), null, 2);

  return { users, rawSample };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settingsData } = await serviceClient
      .from("settings")
      .select("key, value")
      .in("key", ["r3005g_url", "r3005g_username", "r3005g_password"]);

    const settings: Record<string, string> = {};
    for (const row of settingsData || []) {
      if (row.key && row.value) settings[row.key] = row.value;
    }

    const baseUrl = settings["r3005g_url"] || Deno.env.get("R3005G_URL");
    const routerUser = settings["r3005g_username"] || Deno.env.get("R3005G_USERNAME");
    const routerPass = settings["r3005g_password"] || Deno.env.get("R3005G_PASSWORD");

    if (!baseUrl || !routerUser || !routerPass) {
      return new Response(
        JSON.stringify({ error: "R3005G não configurado." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const urlObj = new URL(req.url);
    const action = urlObj.pathname.split("/").pop();

    const cookie = await loginR3005G(baseUrl, routerUser, routerPass);

    // ACTION: discover - find all working endpoints and log raw data
    if (action === "discover") {
      const [endpoints, rawData] = await Promise.all([
        discoverEndpoints(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      console.log("R3005G DISCOVER: Raw user sample (ALL fields):\n" + rawData.rawSample);
      console.log("R3005G DISCOVER: Working endpoints:", JSON.stringify(endpoints));

      return new Response(
        JSON.stringify({
          endpoints,
          total_users: rawData.users.length,
          raw_sample: rawData.rawSample,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: status - check each customer's PPPoE status
    if (action === "status") {
      const { users: routerUsers } = await fetchRawUsers(baseUrl, cookie);

      // Log all fields of first user for debugging
      if (routerUsers.length > 0) {
        console.log("R3005G: First user ALL fields:", JSON.stringify(routerUsers[0]));
      }

      const { data: customers } = await serviceClient
        .from("customers")
        .select("id, nome, usuario_pppoe, ativo");

      // Build lookup by ALL possible plain-text fields in router data
      // Check: userid, user, ips, ip_login, mac, mac_login, mem, etc.
      const result = (customers || []).map((c) => {
        const pppoeUser = c.usuario_pppoe?.toLowerCase() || "";

        // Try to find this customer in router data by checking multiple fields
        const routerMatch = routerUsers.find((ru: Record<string, unknown>) => {
          // Check all string fields for a match with the plain-text username
          for (const fieldName of ["user", "userid", "mem", "ips", "ip_login", "mac", "mac_login"]) {
            const val = ru[fieldName];
            if (typeof val === "string" && val.toLowerCase() === pppoeUser) {
              return true;
            }
          }
          return false;
        });

        return {
          id: c.id,
          nome: c.nome,
          usuario_pppoe: c.usuario_pppoe,
          ativo: c.ativo,
          online: routerMatch ? (routerMatch as Record<string, unknown>).cstate === 97 : false,
          found_in_router: !!routerMatch,
        };
      });

      // Count connected from raw data
      const totalConnected = routerUsers.filter((u: Record<string, unknown>) => u.cstate === 97).length;

      return new Response(
        JSON.stringify({
          customers: result,
          not_in_system: [],
          total_router_users: routerUsers.length,
          total_connected: totalConnected,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "import") {
      return new Response(
        JSON.stringify({ error: "Importação desabilitada até resolver a descriptografia dos usernames." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação desconhecida. Use /status, /discover" }),
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
