import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AES_CONSTANT = "c3W1KF2N=5O47M6ba0E9P8yRdQefjxHSTGpqhrgoIiusmUvzwtVlknBXJALCZDY";

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

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

function deriveKeyIV(serialNumber: string): { keyStr: string; ivStr: string } {
  let sn = serialNumber;
  if (/^(没有序列号|no-ssid)$/i.test(sn)) sn = "";
  const combined = toBase64(sn) + AES_CONSTANT;
  return {
    keyStr: combined.slice(0, 16),
    ivStr: combined.slice(16, 32),
  };
}

function aesEncrypt(plaintext: string, keyStr: string, ivStr: string): string {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(ivStr);
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(plaintext),
    key,
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding }
  );
  return encrypted.toString();
}

async function getRouterInfo(baseUrl: string): Promise<{ sn: string; csrfprotect: string }> {
  // Fetch serial number from base_mini.data
  let sn = "";
  try {
    const baseRes = await fetch(`${baseUrl}/base_mini.data`);
    const baseJson = await baseRes.json();
    if (baseJson?.data) {
      const decoded = JSON.parse(fromBase64(baseJson.data));
      sn = decoded.gwsn || decoded.sn || "";
      console.log("R3005G: SN found:", sn ? sn.substring(0, 4) + "..." : "empty");
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch base_mini.data:", e);
  }

  // Fetch CSRF token
  let csrfprotect = Math.floor(Date.now() / 1000).toString();
  try {
    const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
    const csrfJson = await csrfRes.json();
    if (csrfJson?.data?.csrfprotect) {
      csrfprotect = csrfJson.data.csrfprotect;
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch csrfprotect.data:", e);
  }

  return { sn, csrfprotect };
}

async function loginR3005G(
  baseUrl: string,
  username: string,
  password: string
): Promise<string> {
  const { sn, csrfprotect } = await getRouterInfo(baseUrl);

  console.log("R3005G: Logging in, csrfprotect:", csrfprotect, "user_len:", username.length, "pass_len:", password.length);

  const payload = {
    csrfprotect,
    user: username,
    password: password,
    tm: Date.now() / 1000,
    base64: 1,
  };

  const loginUrl = `${baseUrl}/log_in.cgi`;

  const res = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      Origin: baseUrl,
      Referer: `${baseUrl}/login.html`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  console.log("R3005G login response:", res.status, body);

  let json: { code: number; error?: string };
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
): Promise<Array<{ user: string; pwd: string; cstate: number; gid: number; enable?: number }>> {
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

async function togglePPPoEUser(
  baseUrl: string,
  cookie: string,
  csrfprotect: string,
  targetUser: string,
  enable: boolean
): Promise<{ success: boolean; message: string }> {
  // Try common Intelbras API patterns for toggling user status
  const endpoints = [
    { url: `${baseUrl}/config.data?csrfprotect=${csrfprotect}`, body: { module: "pppoe_server", action: "set_user_status", data: { user: targetUser, enable: enable ? 1 : 0 } } },
    { url: `${baseUrl}/user.data?csrfprotect=${csrfprotect}`, body: { action: "set", data: { user: targetUser, enable: enable ? 1 : 0 } } },
  ];

  for (const ep of endpoints) {
    try {
      console.log("R3005G toggle attempt:", ep.url);
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json;charset=UTF-8",
          Origin: baseUrl,
          Referer: `${baseUrl}/index.html`,
        },
        body: JSON.stringify(ep.body),
      });
      const text = await res.text();
      console.log("R3005G toggle response:", res.status, text);
      const json = JSON.parse(text);
      if (json.code === 0) {
        return { success: true, message: `User ${targetUser} ${enable ? "enabled" : "disabled"} successfully` };
      }
    } catch (e) {
      console.error("R3005G toggle error:", e);
    }
  }

  return { success: false, message: "Could not toggle user. Router API endpoint unknown." };
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

    if (action === "debug") {
      // Debug endpoint - return router info WITHOUT logging in
      const { sn, csrfprotect } = await getRouterInfo(baseUrl);
      const { keyStr, ivStr } = deriveKeyIV(sn);
      
      // Also fetch raw csrfprotect.data to see what's returned
      let rawCsrf = "fetch_failed";
      try {
        const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
        rawCsrf = await csrfRes.text();
      } catch (e) {
        rawCsrf = `error: ${e.message}`;
      }
      
      // Also fetch raw base_mini.data
      let rawBase = "fetch_failed";
      try {
        const baseRes = await fetch(`${baseUrl}/base_mini.data`);
        rawBase = await baseRes.text();
      } catch (e) {
        rawBase = `error: ${e.message}`;
      }

      return new Response(
        JSON.stringify({ 
          sn_prefix: sn.substring(0, 8), 
          sn_length: sn.length,
          csrfprotect, 
          key_prefix: keyStr.substring(0, 6), 
          iv_prefix: ivStr.substring(0, 6),
          raw_csrf: rawCsrf.substring(0, 200),
          raw_base: rawBase.substring(0, 200),
          user_prefix: routerUser!.substring(0, 3),
          pass_length: routerPass!.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Login to router
    const cookie = await loginR3005G(baseUrl, routerUser, routerPass);

    // Fetch PPPoE users
    const routerUsers = await fetchPPPoEUsers(baseUrl, cookie);

    const decodedUsers = routerUsers.map((u) => ({
      usuario_pppoe: fromBase64(u.user),
      senha_pppoe: fromBase64(u.pwd),
      cstate: u.cstate,
      gid: u.gid,
      connected: u.cstate === 97,
      enable: u.enable,
    }));

    if (action === "status") {
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

    if (action === "toggle") {
      // Toggle PPPoE user enable/disable on router
      const body = await req.json();
      const { usuario_pppoe, enable } = body;

      if (!usuario_pppoe) {
        return new Response(
          JSON.stringify({ error: "usuario_pppoe is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { csrfprotect } = await getRouterInfo(baseUrl);
      const result = await togglePPPoEUser(baseUrl, cookie, csrfprotect, usuario_pppoe, !!enable);

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use /status, /import, /toggle, or /debug" }),
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
