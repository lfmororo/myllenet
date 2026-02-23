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

async function getRouterInfo(baseUrl: string): Promise<{ sn: string; csrfprotect: string; captchaActive: boolean }> {
  // Fetch serial number from base_mini.data
  let sn = "";
  try {
    const baseRes = await fetch(`${baseUrl}/base_mini.data`);
    const baseJson = await baseRes.json();
    if (baseJson?.data) {
      const decoded = JSON.parse(fromBase64(baseJson.data));
      sn = decoded.gwsn || decoded.sn || "";
      console.log("R3005G: SN found:", sn);
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch base_mini.data:", e);
  }

  // Fetch CSRF token and check captcha status
  let csrfprotect = Math.floor(Date.now() / 1000).toString();
  let captchaActive = false;
  try {
    const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
    const csrfJson = await csrfRes.json();
    console.log("R3005G: csrfprotect.data response:", JSON.stringify(csrfJson));
    if (csrfJson?.data?.csrfprotect) {
      csrfprotect = csrfJson.data.csrfprotect;
    }
    // Check if captcha is active - when code.key is not empty, a captcha image is required
    if (csrfJson?.data?.code?.key && csrfJson.data.code.key !== "") {
      captchaActive = true;
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch csrfprotect.data:", e);
  }

  return { sn, csrfprotect, captchaActive };
}

async function loginR3005G(
  baseUrl: string,
  plainUser: string,
  plainPass: string
): Promise<string> {
  const { sn, csrfprotect, captchaActive } = await getRouterInfo(baseUrl);

  if (captchaActive) {
    throw new Error("Router captcha is active. Please wait a few minutes or manually log in via browser to reset.");
  }

  // Encrypt credentials using AES with SN-derived key, exactly like the browser does
  const { keyStr, ivStr } = deriveKeyIV(sn);
  const encryptedUser = aesEncrypt(plainUser, keyStr, ivStr);
  const encryptedPass = aesEncrypt(plainPass, keyStr, ivStr);

  console.log("R3005G: SN =", sn, "| keyStr =", keyStr.substring(0, 4) + "...", "| ivStr =", ivStr.substring(0, 4) + "...");

  const payload = {
    csrfprotect,
    user: encryptedUser,
    password: encryptedPass,
    base64: 1,
    tm: Date.now() / 1000,
  };

  console.log("R3005G login payload:", JSON.stringify({ ...payload, password: "***" }));

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
    throw new Error(`Login returned non-JSON: ${body.substring(0, 200)}`);
  }

  if (json.code === 0) {
    const setCookie = res.headers.get("set-cookie");
    const cookie = setCookie ? setCookie.split(";")[0] : "";
    console.log("R3005G login SUCCESS, cookie:", cookie ? "present" : "none");
    return cookie;
  }

  throw new Error(`Login failed: ${json.error || JSON.stringify(json)}`);
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

    // Read R3005G credentials from settings table
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
        JSON.stringify({ error: "R3005G não configurado. Vá em Configurações > R3005G para definir URL e credenciais." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (action === "debug") {
      // Fetch login.js to see the actual login flow
      const results: Record<string, string> = {};
      
      // Fetch login.a8237273.js specifically - this has the login logic
      const targetFiles = ["static/js/login.a8237273.js"];
      for (const file of targetFiles) {
        try {
          const jsRes = await fetch(`${baseUrl}/${file}`);
          if (jsRes.ok) {
            const js = await jsRes.text();
            // Search for login API call patterns
            for (const term of ["log_in", "enCode", "deCode", "password", "base64", "csrfprotect"]) {
              const idx = js.indexOf(term);
              if (idx >= 0) {
                const start = Math.max(0, idx - 400);
                const end = Math.min(js.length, idx + 800);
                results[`login_js__${term}_at_${idx}`] = js.substring(start, end);
              }
            }
            results["login_js_size"] = js.length.toString();
          }
        } catch (e) { results[`error_${file}`] = (e as Error).message; }
      }

      // Also look for Base64 module in chunk-common 
      try {
        const jsRes = await fetch(`${baseUrl}/static/js/chunk-common.b1df80ed.js`);
        if (jsRes.ok) {
          const js = await jsRes.text();
          // Find the Base64 encode implementation
          const b64Idx = js.indexOf("Base64");
          if (b64Idx >= 0) {
            const start = Math.max(0, b64Idx - 100);
            const end = Math.min(js.length, b64Idx + 600);
            results["base64_impl"] = js.substring(start, end);
          }
        }
      } catch (e) { /* skip */ }

      return new Response(
        JSON.stringify(results),
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

      const { csrfprotect: toggleCsrf } = await getRouterInfo(baseUrl);
      const result = await togglePPPoEUser(baseUrl, cookie, toggleCsrf, usuario_pppoe, !!enable);

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
