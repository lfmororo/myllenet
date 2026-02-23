import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import CryptoJS from "npm:crypto-js@4.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AES_CONSTANT = "c3W1KF2N=5O47M6ba0E9P8yRdQefjxHsTGpqhrgoIiusmUvzwtVlknBXJALCZDY";

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
  for (let i = 0; i < len; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
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

// Try decrypt double-base64 + AES-CBC
function tryDecrypt(encryptedDoubleB64: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string | null {
  try {
    const innerB64 = atob(encryptedDoubleB64);
    const decrypted = CryptoJS.AES.decrypt(innerB64, key, {
      iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding,
    });
    const result = decrypted.toString(CryptoJS.enc.Utf8).replace(/\0/g, "").trim();
    if (result && result.length > 0) return result;
  } catch { /* */ }
  return null;
}

function getAllKeyApproaches(serialNumber: string): Array<{ name: string; key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray }> {
  const combined = serialNumber + AES_CONSTANT;
  const reversed = AES_CONSTANT + serialNumber;
  const md5Hash = CryptoJS.MD5(combined);
  const md5Rev = CryptoJS.MD5(reversed);
  const sha256 = CryptoJS.SHA256(combined);
  const sha256Hex = sha256.toString();
  const md5Serial = CryptoJS.MD5(serialNumber);
  const md5Const = CryptoJS.MD5(AES_CONSTANT);

  return [
    { name: "MD5(sn+const) key=iv", key: CryptoJS.enc.Hex.parse(md5Hash.toString()), iv: CryptoJS.enc.Hex.parse(md5Hash.toString()) },
    { name: "MD5(sn+const), zero IV", key: CryptoJS.enc.Hex.parse(md5Hash.toString()), iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000") },
    { name: "serial key, const IV", key: CryptoJS.enc.Utf8.parse(serialNumber.padEnd(16, "\0").substring(0, 16)), iv: CryptoJS.enc.Utf8.parse(AES_CONSTANT.substring(0, 16)) },
    { name: "const key, serial IV", key: CryptoJS.enc.Utf8.parse(AES_CONSTANT.substring(0, 16)), iv: CryptoJS.enc.Utf8.parse(serialNumber.padEnd(16, "\0").substring(0, 16)) },
    { name: "SHA256 split", key: CryptoJS.enc.Hex.parse(sha256Hex.substring(0, 32)), iv: CryptoJS.enc.Hex.parse(sha256Hex.substring(32, 64)) },
    { name: "MD5(serial) key, MD5(const) IV", key: CryptoJS.enc.Hex.parse(md5Serial.toString()), iv: CryptoJS.enc.Hex.parse(md5Const.toString()) },
    { name: "MD5(const+sn) key=iv", key: CryptoJS.enc.Hex.parse(md5Rev.toString()), iv: CryptoJS.enc.Hex.parse(md5Rev.toString()) },
    { name: "combined[:16] key, zero IV", key: CryptoJS.enc.Utf8.parse(combined.substring(0, 16)), iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000") },
  ];
}

async function getRouterInfo(baseUrl: string): Promise<{ csrfprotect: string; captchaActive: boolean }> {
  let csrfprotect = Math.floor(Date.now() / 1000).toString();
  let captchaActive = false;
  try {
    const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
    const csrfJson = await csrfRes.json();
    if (csrfJson?.data?.csrfprotect) csrfprotect = csrfJson.data.csrfprotect;
    if (csrfJson?.data?.code?.key && csrfJson.data.code.key !== "") captchaActive = true;
  } catch (e) { console.error("csrfprotect error:", e); }
  return { csrfprotect, captchaActive };
}

async function loginR3005G(baseUrl: string, plainUser: string, plainPass: string): Promise<string> {
  const { csrfprotect, captchaActive } = await getRouterInfo(baseUrl);
  if (captchaActive) throw new Error("Router captcha ativo.");
  const payload = { csrfprotect, user: encodeCredential(plainUser), password: encodeCredential(plainPass), base64: 1, tm: Date.now() / 1000 };
  const res = await fetch(`${baseUrl}/log_in.cgi`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", Origin: baseUrl, Referer: `${baseUrl}/login.html` },
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

// Fetch serial number - try many endpoints and log everything
async function fetchSerialNumber(baseUrl: string, cookie: string): Promise<string | null> {
  const endpoints = [
    "sysinfo.data", "system_status.data", "device_info.data", "status.data",
    "system.data", "device.data", "wan.data", "overview.data",
    "sysConf.data", "sysConfig.data", "config.data", "info.data",
    "deviceSn.data", "device_sn.data", "product.data", "version.data",
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}/${ep}`, { headers: { Cookie: cookie } });
      if (!res.ok) continue;
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      if (json.code !== 0) continue;

      let data = json.data;
      if (typeof data === "string") {
        try { data = JSON.parse(fromBase64(data)); } catch { /* keep */ }
      }
      if (!data || typeof data !== "object") continue;

      // Log ALL data from this endpoint
      console.log(`R3005G SN: ${ep} =>`, JSON.stringify(data).substring(0, 500));

      // Search recursively for SN-like fields
      const snFields = ["sn", "serial", "serial_number", "serialNumber", "device_sn", "SN", "serialNum", "devicesn", "serial_num"];
      const searchObj = (obj: Record<string, unknown>, path: string) => {
        for (const [k, v] of Object.entries(obj)) {
          if (snFields.includes(k.toLowerCase()) && typeof v === "string" && v.length > 4) {
            console.log(`R3005G SN: FOUND at ${path}.${k} = ${v}`);
            return v;
          }
          if (typeof v === "object" && v && !Array.isArray(v)) {
            const found = searchObj(v as Record<string, unknown>, `${path}.${k}`);
            if (found) return found;
          }
        }
        return null;
      };

      const found = searchObj(data, ep);
      if (found) return found;
    } catch { /* skip */ }
  }
  return null;
}

// Also try to extract SN/key from router's JavaScript files
async function fetchKeyFromJS(baseUrl: string, cookie: string): Promise<string | null> {
  const jsFiles = [
    "static/js/chunk-common.js", "static/js/app.js", "js/chunk-common.js", "js/app.js",
    "static/js/chunk-vendors.js", "js/main.js", "static/js/main.js",
  ];

  for (const jsFile of jsFiles) {
    try {
      const res = await fetch(`${baseUrl}/${jsFile}`, { headers: { Cookie: cookie } });
      if (!res.ok) continue;
      const text = await res.text();

      // Look for serial number pattern or AES key in JS
      // Common patterns: .sn= , serialNumber: , "sn":"xxx"
      const patterns = [
        /["\']sn["\']\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /serial[Nn]umber\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /device_sn\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /AES\.decrypt[^)]*["\']([A-Fa-f0-9]{32})["\']/,
      ];

      for (const pat of patterns) {
        const match = text.match(pat);
        if (match?.[1]) {
          console.log(`R3005G JS: Found potential key in ${jsFile}: ${match[1]}`);
          return match[1];
        }
      }

      // Look for the constant string near AES logic
      if (text.includes(AES_CONSTANT) || text.includes("c3W1KF2N")) {
        // Find surrounding code (200 chars around the match)
        const idx = text.indexOf("c3W1KF2N");
        const snippet = text.substring(Math.max(0, idx - 200), idx + 300);
        console.log(`R3005G JS: Found AES constant in ${jsFile}, context:`, snippet);
      }

      // Also look for how sn is used
      const snUsageMatch = text.match(/\.sn\b[^;]{0,100}/);
      if (snUsageMatch) {
        console.log(`R3005G JS: .sn usage in ${jsFile}:`, snUsageMatch[0]);
      }

      console.log(`R3005G JS: ${jsFile} loaded (${text.length} bytes)`);
    } catch { /* skip */ }
  }
  return null;
}

async function fetchRawUsers(baseUrl: string, cookie: string): Promise<Record<string, unknown>[]> {
  // Try multiple endpoints for PPPoE user data
  const endpoints = ["user.data", "pppoeUser.data", "pppoe_user.data", "pppoe.data", "pppoeUserIndex.data"];
  
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}/${ep}`, { headers: { Cookie: cookie } });
      if (!res.ok) { console.log(`R3005G fetchUsers: ${ep} => ${res.status}`); continue; }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { console.log(`R3005G fetchUsers: ${ep} not JSON`); continue; }
      
      console.log(`R3005G fetchUsers: ${ep} code=${json.code}, dataType=${typeof json.data}`);
      
      let userData = json.data;
      if (typeof json.data === "string") {
        try { 
          const decoded = fromBase64(json.data);
          userData = JSON.parse(decoded);
          console.log(`R3005G fetchUsers: ${ep} decoded from base64`);
        } catch { /* keep */ }
      }
      
      const users = userData?.all || userData?.list || (Array.isArray(userData) ? userData : []);
      if (users.length > 0) {
        // Log first 3 users with ALL their fields
        console.log(`R3005G fetchUsers: ${ep} found ${users.length} users`);
        for (let i = 0; i < Math.min(3, users.length); i++) {
          console.log(`R3005G USER[${i}] keys:`, Object.keys(users[i]).join(", "));
          console.log(`R3005G USER[${i}] data:`, JSON.stringify(users[i]).substring(0, 500));
        }
        return users;
      }
    } catch (e) { console.log(`R3005G fetchUsers: ${ep} error:`, e.message); }
  }
  
  throw new Error("No PPPoE user data found from any endpoint");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settingsData } = await serviceClient.from("settings").select("key, value").in("key", ["r3005g_url", "r3005g_username", "r3005g_password"]);
    const settings: Record<string, string> = {};
    for (const row of settingsData || []) { if (row.key && row.value) settings[row.key] = row.value; }

    const baseUrl = settings["r3005g_url"] || Deno.env.get("R3005G_URL");
    const routerUser = settings["r3005g_username"] || Deno.env.get("R3005G_USERNAME");
    const routerPass = settings["r3005g_password"] || Deno.env.get("R3005G_PASSWORD");

    if (!baseUrl || !routerUser || !routerPass) {
      return new Response(JSON.stringify({ error: "R3005G não configurado." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const urlObj = new URL(req.url);
    const action = urlObj.pathname.split("/").pop();
    const cookie = await loginR3005G(baseUrl, routerUser, routerPass);

    // ACTION: discover
    if (action === "discover") {
      const [serialNumber, jsKey, routerUsers] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchKeyFromJS(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      const effectiveSN = serialNumber || jsKey;
      const firstUser = routerUsers[0] as Record<string, unknown> | undefined;
      const testEncrypted = firstUser?.user as string || "";

      console.log("R3005G DISCOVER: SN from endpoints:", serialNumber);
      console.log("R3005G DISCOVER: Key from JS:", jsKey);
      console.log("R3005G DISCOVER: First user:", JSON.stringify(firstUser));

      const decryptionResults: Record<string, string | null> = {};
      if (effectiveSN && testEncrypted) {
        for (const a of getAllKeyApproaches(effectiveSN)) {
          const result = tryDecrypt(testEncrypted, a.key, a.iv);
          decryptionResults[a.name] = result;
          if (result) console.log(`R3005G DISCOVER: ✅ "${a.name}" => "${result}"`);
        }
      }

      return new Response(JSON.stringify({
        serial_number: serialNumber, js_key: jsKey,
        total_users: routerUsers.length, first_user_encrypted: testEncrypted,
        decryption_results: decryptionResults,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: status
    if (action === "status") {
      const [serialNumber, jsKey, routerUsers] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchKeyFromJS(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      const effectiveSN = serialNumber || jsKey;
      console.log(`R3005G STATUS: SN=${effectiveSN || "NOT FOUND"}, jsKey=${jsKey || "NOT FOUND"}, users=${routerUsers.length}`);

      // Find working decryption
      let workingApproach: { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray } | null = null;
      if (effectiveSN) {
        const testEnc = (routerUsers[0] as Record<string, unknown>)?.user as string;
        if (testEnc) {
          for (const a of getAllKeyApproaches(effectiveSN)) {
            const result = tryDecrypt(testEnc, a.key, a.iv);
            if (result && /^[a-zA-Z0-9._@\-]+$/.test(result)) {
              console.log(`R3005G STATUS: Using "${a.name}", test="${result}"`);
              workingApproach = { key: a.key, iv: a.iv };
              break;
            }
          }
        }
      }

      // Build decrypted map
      const routerUserMap = new Map<string, Record<string, unknown>>();
      if (workingApproach) {
        for (const ru of routerUsers) {
          const ruObj = ru as Record<string, unknown>;
          const dec = tryDecrypt(ruObj.user as string, workingApproach.key, workingApproach.iv);
          if (dec) routerUserMap.set(dec.toLowerCase(), ruObj);
        }
      }

      console.log(`R3005G STATUS: Decrypted ${routerUserMap.size}/${routerUsers.length}`);

      // FALLBACK: Check if user field might already be plaintext or try direct field matching
      if (routerUserMap.size === 0) {
        console.log("R3005G STATUS: Trying plaintext/direct field matching fallback...");
        
        // Check ALL possible username fields in router data
        const possibleFields = ["user", "name", "username", "userid", "UserID", "pppoe_user", "account", "login", "mem", "mac"];
        const firstUser = routerUsers[0] as Record<string, unknown>;
        
        for (const field of possibleFields) {
          const val = firstUser?.[field];
          if (val && typeof val === "string") {
            console.log(`R3005G FALLBACK: field "${field}" = "${String(val).substring(0, 80)}"`);
          }
        }
        
        // Try treating 'user' or 'name' as plaintext username
        for (const field of ["name", "user", "username", "userid", "UserID", "account"]) {
          let matched = 0;
          const testMap = new Map<string, Record<string, unknown>>();
          for (const ru of routerUsers) {
            const ruObj = ru as Record<string, unknown>;
            const val = ruObj[field] as string;
            if (val && typeof val === "string") {
              testMap.set(val.toLowerCase(), ruObj);
            }
          }
          // Check if any known customer PPPoE matches
          const { data: customers } = await serviceClient.from("customers").select("usuario_pppoe");
          for (const c of customers || []) {
            if (testMap.has(c.usuario_pppoe?.toLowerCase())) matched++;
          }
          if (matched > 0) {
            console.log(`R3005G FALLBACK: ✅ field "${field}" matched ${matched} customers! Using this field.`);
            for (const [k, v] of testMap) routerUserMap.set(k, v);
            break;
          }
        }
        
        console.log(`R3005G STATUS: After fallback: ${routerUserMap.size} mapped`);
      }

      if (routerUserMap.size > 0) {
        console.log("R3005G STATUS: Samples:", [...routerUserMap.keys()].slice(0, 5).join(", "));
      }

      const { data: customers } = await serviceClient.from("customers").select("id, nome, usuario_pppoe, ativo");
      const customerPPPoEs = new Set((customers || []).map(c => c.usuario_pppoe?.toLowerCase()).filter(Boolean));

      const result = (customers || []).map((c) => {
        const pppoeUser = c.usuario_pppoe?.toLowerCase() || "";
        const routerMatch = routerUserMap.get(pppoeUser);
        return {
          id: c.id, nome: c.nome, usuario_pppoe: c.usuario_pppoe, ativo: c.ativo,
          online: routerMatch ? (routerMatch.cstate === 97 || routerMatch.state === "on" || routerMatch.online === true || routerMatch.online === 1) : false,
          found_in_router: !!routerMatch,
        };
      });

      const notInSystem: Array<{ usuario_pppoe: string; online: boolean }> = [];
      for (const [username, ruObj] of routerUserMap) {
        if (!customerPPPoEs.has(username)) {
          notInSystem.push({ 
            usuario_pppoe: username, 
            online: ruObj.cstate === 97 || ruObj.state === "on" || ruObj.online === true || ruObj.online === 1,
          });
        }
      }

      return new Response(JSON.stringify({
        customers: result, not_in_system: notInSystem,
        total_router_users: routerUsers.length,
        total_connected: routerUsers.filter((u: Record<string, unknown>) => 
          u.cstate === 97 || u.state === "on" || u.online === true || u.online === 1
        ).length,
        decryption_success: routerUserMap.size > 0, decrypted_count: routerUserMap.size,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Use /status ou /discover" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("R3005G error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
