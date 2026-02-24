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

// Try decrypt with multiple padding strategies, base64 layers, and modes
function tryDecrypt(encryptedDoubleB64: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray, mode?: typeof CryptoJS.mode.CBC): string | null {
  const paddings = [CryptoJS.pad.ZeroPadding, CryptoJS.pad.Pkcs7, CryptoJS.pad.NoPadding];
  const aesMode = mode || CryptoJS.mode.CBC;
  // Try double-base64 first, then single-base64
  const candidates = [encryptedDoubleB64];
  try { const inner = atob(encryptedDoubleB64); candidates.push(inner); } catch { /* skip */ }
  
  for (const input of candidates) {
    for (const padding of paddings) {
      try {
        const opts: Record<string, unknown> = { mode: aesMode, padding };
        if (aesMode !== CryptoJS.mode.ECB) opts.iv = iv;
        const decrypted = CryptoJS.AES.decrypt(input, key, opts);
        const result = decrypted.toString(CryptoJS.enc.Utf8).replace(/\0/g, "").trim();
        if (result && result.length > 1 && /^[a-zA-Z0-9._@\-]+$/.test(result)) return result;
      } catch { /* */ }
    }
  }
  return null;
}

// Try passphrase-based decryption (OpenSSL EVP key derivation)
function tryDecryptPassphrase(encryptedDoubleB64: string, passphrase: string): string | null {
  const candidates = [encryptedDoubleB64];
  try { const inner = atob(encryptedDoubleB64); candidates.push(inner); } catch { /* skip */ }
  
  for (const input of candidates) {
    for (const padding of [CryptoJS.pad.Pkcs7, CryptoJS.pad.ZeroPadding]) {
      try {
        const decrypted = CryptoJS.AES.decrypt(input, passphrase, { padding });
        const result = decrypted.toString(CryptoJS.enc.Utf8).replace(/\0/g, "").trim();
        if (result && result.length > 1 && /^[a-zA-Z0-9._@\-]+$/.test(result)) return result;
      } catch { /* */ }
    }
  }
  return null;
}

// Encrypt a plaintext string and return all possible encoded variants
function tryEncryptVariants(plaintext: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string[] {
  const results: string[] = [];
  for (const padding of [CryptoJS.pad.ZeroPadding, CryptoJS.pad.Pkcs7]) {
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv, mode: CryptoJS.mode.CBC, padding,
    });
    const innerB64 = encrypted.toString();
    // Double base64
    const bytes = new TextEncoder().encode(innerB64);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    results.push(btoa(binary));
    // Single base64
    results.push(innerB64);
  }
  return results;
}

interface KeyApproach { name: string; key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray; mode?: typeof CryptoJS.mode.CBC }

// Exact logic from router's chunk-common.js:
// combined = Base64(SN) + AES_CONSTANT; key = combined[0:16]; iv = combined[16:32]
function getRouterKeyIV(serialNumber: string): { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray } {
  let sn = serialNumber;
  if (/^(没有序列号|no-ssid)$/i.test(sn)) sn = "";
  const b64sn = btoa(sn);
  const combined = b64sn + AES_CONSTANT;
  const keyStr = combined.slice(0, 16);
  const ivStr = combined.slice(16, 32);
  console.log(`R3005G KEY: Base64(SN)="${b64sn}", key="${keyStr}", iv="${ivStr}"`);
  return {
    key: CryptoJS.enc.Utf8.parse(keyStr),
    iv: CryptoJS.enc.Utf8.parse(ivStr),
  };
}

function getAllKeyApproaches(serialNumber: string): KeyApproach[] {
  const router = getRouterKeyIV(serialNumber);
  return [
    // PRIMARY: exact router logic
    { name: "ROUTER_EXACT: B64(sn)+const", key: router.key, iv: router.iv },
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

async function loginR3005G(baseUrl: string, plainUser: string, plainPass: string): Promise<{ cookie: string; loginData: Record<string, unknown> }> {
  const { csrfprotect, captchaActive } = await getRouterInfo(baseUrl);
  if (captchaActive) throw new Error("Router captcha ativo.");
  const payload = { csrfprotect, user: encodeCredential(plainUser), password: encodeCredential(plainPass), base64: 1, tm: Date.now() / 1000 };
  const res = await fetch(`${baseUrl}/log_in.cgi`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", Origin: baseUrl, Referer: `${baseUrl}/login.html` },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(body); } catch { throw new Error(`Login non-JSON: ${body.substring(0, 200)}`); }
  console.log("R3005G LOGIN response:", JSON.stringify(json).substring(0, 500));
  if (json.code === 0) {
    const setCookie = res.headers.get("set-cookie");
    const cookie = setCookie ? setCookie.split(";")[0] : "";
    return { cookie, loginData: json };
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
  // First, discover actual JS paths from index.html
  const jsFiles: string[] = [];
  try {
    const htmlRes = await fetch(`${baseUrl}/index.html`, { headers: { Cookie: cookie } });
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      // Extract script src attributes
      const scriptMatches = html.matchAll(/src=["']([^"']*\.js[^"']*?)["']/g);
      for (const m of scriptMatches) {
        const path = m[1].replace(/^\//, "");
        jsFiles.push(path);
        console.log(`R3005G JS: Found script in HTML: ${path}`);
      }
    }
  } catch { /* skip */ }
  
  // Add common paths as fallback
  jsFiles.push(
    "static/js/chunk-common.js", "static/js/app.js", "js/chunk-common.js", "js/app.js",
    "static/js/chunk-vendors.js", "js/main.js", "static/js/main.js",
  );

  for (const jsFile of jsFiles) {
    try {
      const res = await fetch(`${baseUrl}/${jsFile}`, { headers: { Cookie: cookie } });
      if (!res.ok) continue;
      const text = await res.text();

      // Look for serial number or AES key patterns
      const patterns = [
        /["\']sn["\']\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /serial[Nn]umber\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /device_sn\s*[:=]\s*["\']([A-Za-z0-9]+)["\']/,
        /\.sn\s*=\s*["\']([A-Za-z0-9]+)["\']/,
        /sn:\s*["\']([A-Za-z0-9]{8,})["\']/,
      ];

      for (const pat of patterns) {
        const match = text.match(pat);
        if (match?.[1]) {
          console.log(`R3005G JS: Found potential key in ${jsFile}: ${match[1]}`);
          return match[1];
        }
      }

      // Look for how the AES constant is used - find the SN variable near it
      if (text.includes("c3W1KF2N")) {
        const idx = text.indexOf("c3W1KF2N");
        const snippet = text.substring(Math.max(0, idx - 300), idx + 400);
        console.log(`R3005G JS: AES constant context in ${jsFile}:`, snippet.substring(0, 600));
        
        // Try to find how SN is referenced near the constant
        const snRefMatch = snippet.match(/(\w+)\.sn\b/);
        if (snRefMatch) console.log(`R3005G JS: SN reference: ${snRefMatch[0]}`);
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
    const { data: settingsData } = await serviceClient.from("settings").select("key, value").in("key", ["r3005g_url", "r3005g_username", "r3005g_password", "r3005g_serial_number"]);
    const settings: Record<string, string> = {};
    for (const row of settingsData || []) { if (row.key && row.value) settings[row.key] = row.value; }

    const baseUrl = settings["r3005g_url"] || Deno.env.get("R3005G_URL");
    const routerUser = settings["r3005g_username"] || Deno.env.get("R3005G_USERNAME");
    const routerPass = settings["r3005g_password"] || Deno.env.get("R3005G_PASSWORD");
    const configSN = settings["r3005g_serial_number"] || null;

    if (!baseUrl || !routerUser || !routerPass) {
      return new Response(JSON.stringify({ error: "R3005G não configurado." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const urlObj = new URL(req.url);
    const action = urlObj.pathname.split("/").pop();
    const { cookie, loginData } = await loginR3005G(baseUrl, routerUser, routerPass);

    // Extract SN from login response
    let loginSN: string | null = null;
    const searchLoginData = (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        const kl = k.toLowerCase();
        if ((kl === "sn" || kl === "serial" || kl === "serial_number" || kl === "serialnumber" || kl === "devicesn") && typeof v === "string" && v.length > 4) {
          return v;
        }
        if (typeof v === "object" && v && !Array.isArray(v)) {
          const found = searchLoginData(v as Record<string, unknown>);
          if (found) return found;
        }
      }
      return null;
    };
    loginSN = searchLoginData(loginData);
    if (loginSN) console.log("R3005G: SN from login:", loginSN);

    // ACTION: discover
    if (action === "discover") {
      const [serialNumber, jsKey, routerUsers] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchKeyFromJS(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      const effectiveSN = configSN || loginSN || serialNumber || jsKey;
      const firstUser = routerUsers[0] as Record<string, unknown> | undefined;
      const testEncrypted = firstUser?.user as string || "";

      console.log("R3005G DISCOVER: SN login:", loginSN, "endpoints:", serialNumber, "JS:", jsKey);
      console.log("R3005G DISCOVER: First user:", JSON.stringify(firstUser));

      const decryptionResults: Record<string, string | null> = {};
      if (effectiveSN && testEncrypted) {
        for (const a of getAllKeyApproaches(effectiveSN)) {
          const result = tryDecrypt(testEncrypted, a.key, a.iv, a.mode);
          decryptionResults[a.name] = result;
          if (result) console.log(`R3005G DISCOVER: ✅ "${a.name}" => "${result}"`);
        }
        // Also try passphrase-based
        const passphrases = [effectiveSN, AES_CONSTANT, effectiveSN + AES_CONSTANT, AES_CONSTANT + effectiveSN,
          CryptoJS.MD5(effectiveSN + AES_CONSTANT).toString(), CryptoJS.MD5(AES_CONSTANT + effectiveSN).toString()];
        for (const pp of passphrases) {
          const result = tryDecryptPassphrase(testEncrypted, pp);
          decryptionResults[`passphrase:${pp.substring(0,20)}`] = result;
          if (result) console.log(`R3005G DISCOVER: ✅ passphrase "${pp.substring(0,20)}" => "${result}"`);
        }
      }

      return new Response(JSON.stringify({
        serial_number: serialNumber, login_sn: loginSN, js_key: jsKey,
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

      const snCandidates = [configSN, loginSN, serialNumber, jsKey].filter(Boolean) as string[];
      console.log(`R3005G STATUS: SN candidates=[${snCandidates.join(", ") || "NONE"}], users=${routerUsers.length}`);

      // Try each SN candidate with each key approach
      let workingApproach: { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray; mode?: typeof CryptoJS.mode.CBC } | null = null;
      let workingPassphrase: string | null = null;
      const testEnc = (routerUsers[0] as Record<string, unknown>)?.user as string;
      
      if (testEnc) {
        // Log what we're trying to decrypt
        let innerB64 = testEnc;
        try { innerB64 = atob(testEnc); } catch { /* */ }
        console.log(`R3005G STATUS: Test encrypted="${testEnc.substring(0,40)}", inner="${innerB64.substring(0,40)}"`);
        
        // Try key-based approaches
        for (const sn of snCandidates) {
          for (const a of getAllKeyApproaches(sn)) {
            const result = tryDecrypt(testEnc, a.key, a.iv, a.mode);
            if (result && /^[a-zA-Z0-9._@\-]+$/.test(result)) {
              console.log(`R3005G STATUS: ✅ SN="${sn}", approach="${a.name}", test="${result}"`);
              workingApproach = { key: a.key, iv: a.iv, mode: a.mode };
              break;
            }
          }
          if (workingApproach) break;
        }
        
        // Try passphrase-based decryption
        if (!workingApproach) {
          const passphrases = [
            ...snCandidates,
            AES_CONSTANT,
            ...snCandidates.map(sn => sn + AES_CONSTANT),
            ...snCandidates.map(sn => AES_CONSTANT + sn),
            ...snCandidates.map(sn => CryptoJS.MD5(sn + AES_CONSTANT).toString()),
            ...snCandidates.map(sn => CryptoJS.MD5(AES_CONSTANT + sn).toString()),
          ];
          for (const pp of passphrases) {
            const result = tryDecryptPassphrase(testEnc, pp);
            if (result) {
              console.log(`R3005G STATUS: ✅ Passphrase="${pp.substring(0,30)}..." => "${result}"`);
              workingPassphrase = pp;
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
          const dec = tryDecrypt(ruObj.user as string, workingApproach.key, workingApproach.iv, workingApproach.mode);
          if (dec) routerUserMap.set(dec.toLowerCase(), ruObj);
        }
      } else if (workingPassphrase) {
        for (const ru of routerUsers) {
          const ruObj = ru as Record<string, unknown>;
          const dec = tryDecryptPassphrase(ruObj.user as string, workingPassphrase);
          if (dec) routerUserMap.set(dec.toLowerCase(), ruObj);
        }
      }

      console.log(`R3005G STATUS: Decrypted ${routerUserMap.size}/${routerUsers.length}`);

      // ENCRYPT-AND-COMPARE FALLBACK: encrypt known usernames and match against router data
      if (routerUserMap.size === 0 && testEnc) {
        console.log("R3005G STATUS: Trying encrypt-and-compare fallback...");
        
        // Get a few known usernames to test
        const { data: testCustomers } = await serviceClient.from("customers").select("usuario_pppoe").limit(10);
        const knownUsernames = (testCustomers || []).map(c => c.usuario_pppoe).filter(Boolean);
        
        // Build encrypted set from router
        const routerEncryptedUsers = new Set(routerUsers.map((ru: Record<string, unknown>) => ru.user as string));
        
        // Try the `mem` field as potential SN (same for all users: "UHNMSTFrMjVHZDMzN3ZmeGtBeWIxQT09")
        const memVal = (routerUsers[0] as Record<string, unknown>)?.mem as string;
        let memDecoded = memVal;
        try { memDecoded = atob(memVal); } catch { /* keep */ }
        try { memDecoded = atob(memDecoded); } catch { /* keep */ }
        
        const additionalSNs = [memVal, memDecoded];
        if (memVal) console.log(`R3005G ENCRYPT-COMPARE: mem raw="${memVal}", decoded="${memDecoded}"`);
        
        // Try all SN candidates including mem-derived ones
        const allSNs = [...snCandidates, ...additionalSNs].filter(Boolean) as string[];
        
        // Log a sample encrypted username for debugging
        if (knownUsernames.length > 0) {
          console.log(`R3005G ENCRYPT-COMPARE: Testing ${knownUsernames.length} known usernames: ${knownUsernames.slice(0, 3).join(", ")}`);
          console.log(`R3005G ENCRYPT-COMPARE: Router has ${routerEncryptedUsers.size} encrypted users, sample: ${[...routerEncryptedUsers].slice(0, 2).join(", ")}`);
        }

        for (const sn of allSNs) {
          for (const approach of getAllKeyApproaches(sn)) {
            let matches = 0;
            for (const username of knownUsernames) {
              const variants = tryEncryptVariants(username, approach.key, approach.iv);
              for (const enc of variants) {
                if (routerEncryptedUsers.has(enc)) {
                  matches++;
                  break;
                }
              }
            }
            if (matches > 0) {
              console.log(`R3005G ENCRYPT-COMPARE: ✅ SN="${sn.substring(0, 20)}", approach="${approach.name}" matched ${matches}/${knownUsernames.length}`);
              workingApproach = { key: approach.key, iv: approach.iv };
              for (const ru of routerUsers) {
                const ruObj = ru as Record<string, unknown>;
                const dec = tryDecrypt(ruObj.user as string, approach.key, approach.iv);
                if (dec) routerUserMap.set(dec.toLowerCase(), ruObj);
              }
              break;
            }
          }
          if (routerUserMap.size > 0) break;
        }
        
        // If still nothing, try direct plaintext field matching
        if (routerUserMap.size === 0) {
          console.log("R3005G STATUS: Trying plaintext field matching...");
          const possibleFields = ["user", "name", "username", "userid", "UserID", "account"];
          const firstUser = routerUsers[0] as Record<string, unknown>;
          for (const field of possibleFields) {
            const val = firstUser?.[field];
            if (val && typeof val === "string") {
              console.log(`R3005G FALLBACK: field "${field}" = "${String(val).substring(0, 80)}"`);
            }
          }
          
          for (const field of ["name", "user", "username", "account"]) {
            const testMap = new Map<string, Record<string, unknown>>();
            for (const ru of routerUsers) {
              const ruObj = ru as Record<string, unknown>;
              const val = ruObj[field] as string;
              if (val && typeof val === "string") testMap.set(val.toLowerCase(), ruObj);
            }
            let matched = 0;
            for (const username of knownUsernames) {
              if (testMap.has(username.toLowerCase())) matched++;
            }
            if (matched > 0) {
              console.log(`R3005G FALLBACK: ✅ field "${field}" matched ${matched}!`);
              for (const [k, v] of testMap) routerUserMap.set(k, v);
              break;
            }
          }
        }
        
        console.log(`R3005G STATUS: After fallback: ${routerUserMap.size} mapped`);
      }

      if (routerUserMap.size > 0) {
        console.log("R3005G STATUS: Samples:", [...routerUserMap.keys()].slice(0, 5).join(", "));
      }

      const { data: customers } = await serviceClient.from("customers").select("id, nome, usuario_pppoe, ativo");
      const customerPPPoEs = new Set((customers || []).map(c => c.usuario_pppoe?.toLowerCase()).filter(Boolean));

      const isOnline = (ru: Record<string, unknown>): boolean => {
        // "t" or "tm" > 0 means active session (uptime in seconds)
        const t = Number(ru.t ?? ru.tm ?? 0);
        if (t > 0) return true;
        // Fallback checks
        if (ru.cstate === 97 || ru.state === "on" || ru.online === true || ru.online === 1) return true;
        return false;
      };

      const result = (customers || []).map((c) => {
        const pppoeUser = c.usuario_pppoe?.toLowerCase() || "";
        const routerMatch = routerUserMap.get(pppoeUser);
        return {
          id: c.id, nome: c.nome, usuario_pppoe: c.usuario_pppoe, ativo: c.ativo,
          online: routerMatch ? isOnline(routerMatch) : false,
          found_in_router: !!routerMatch,
        };
      });

      const notInSystem: Array<{ usuario_pppoe: string; online: boolean }> = [];
      for (const [username, ruObj] of routerUserMap) {
        if (!customerPPPoEs.has(username)) {
          notInSystem.push({ 
            usuario_pppoe: username, 
            online: isOnline(ruObj),
          });
        }
      }

      const isOnlineRaw = (u: Record<string, unknown>): boolean => {
        const t = Number(u.t ?? u.tm ?? 0);
        if (t > 0) return true;
        if (u.cstate === 97 || u.state === "on" || u.online === true || u.online === 1) return true;
        return false;
      };

      return new Response(JSON.stringify({
        customers: result, not_in_system: notInSystem,
        total_router_users: routerUsers.length,
        total_connected: routerUsers.filter((u: Record<string, unknown>) => isOnlineRaw(u)).length,
        decryption_success: routerUserMap.size > 0, decrypted_count: routerUserMap.size,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: extract-js - download and analyze router JS files for decryption logic
    if (action === "extract-js") {
      const result: Record<string, string> = {};
      
      // 1. Fetch multiple HTML pages and extract ALL content
      const htmlPages = ["index.html", "login.html", "main.html", "home.html", "pppoe.html", "user.html", "system.html", ""];
      const jsFiles: string[] = [];
      
      for (const page of htmlPages) {
        try {
          const res = await fetch(`${baseUrl}/${page}`, { headers: { Cookie: cookie } });
          if (!res.ok) continue;
          const html = await res.text();
          
          // Extract script src tags AND link preload tags
          const srcMatches = [...html.matchAll(/src=["']?([^"'\s>]+\.js[^"'\s>]*)["']?/g)];
          const linkMatches = [...html.matchAll(/href=["']?([^"'\s>]+\.js[^"'\s>]*)["']?/g)];
          for (const m of [...srcMatches, ...linkMatches]) {
            const path = m[1].replace(/^\.\//, "").replace(/^\//, "");
            if (!jsFiles.includes(path)) jsFiles.push(path);
          }
          
          // Extract inline scripts
          const inlineMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
          for (let i = 0; i < inlineMatches.length; i++) {
            const content = inlineMatches[i][1].trim();
            if (content.length > 10) {
              result[`${page || "root"}_inline_${i}`] = content.substring(0, 3000);
            }
          }
          
          // Save full HTML (truncated) for analysis
          result[`${page || "root"}_html`] = html.substring(0, 5000);
        } catch { /* skip */ }
      }
      
      // 2. Try many Intelbras-specific JS paths
      // No extra fallback paths needed - we extract real paths from HTML above
      result["js_paths_discovered"] = jsFiles.join(", ");
      
      // 3. Download each discovered JS file - prioritize chunk-common and index (crypto logic)
      const foundFiles: string[] = [];
      const priorityOrder = (f: string) => {
        if (f.includes("chunk-common")) return 0;
        if (f.includes("index.") && f.includes(".js")) return 1;
        if (f.includes("login.")) return 2;
        if (f.includes("chunk-vendors") || f.includes("chunk-element")) return 10;
        return 5;
      };
      jsFiles.sort((a, b) => priorityOrder(a) - priorityOrder(b));

      for (const jsFile of jsFiles) {
        if (!jsFile.endsWith(".js")) continue;
        try {
          const res = await fetch(`${baseUrl}/${jsFile}`, { headers: { Cookie: cookie } });
          if (!res.ok) continue;
          const text = await res.text();
          foundFiles.push(jsFile);
          result[`${jsFile}_size`] = `${text.length} bytes`;
          
          const keywords = ["decrypt", "encrypt", "AES", "CryptoJS", "c3W1KF", "aes_", "MD5", "md5", "cipher", "decipher"];
          for (const kw of keywords) {
            let searchFrom = 0;
            let count = 0;
            while (count < 3) {
              const idx = text.indexOf(kw, searchFrom);
              if (idx === -1) break;
              const start = Math.max(0, idx - 400);
              const end = Math.min(text.length, idx + 600);
              result[`${jsFile}__${kw}_${count}`] = text.substring(start, end);
              searchFrom = idx + kw.length;
              count++;
            }
          }
          
          // For chunk-common, extract large context around AES constant
          if (jsFile.includes("chunk-common")) {
            const cryptoIdx = text.indexOf("c3W1KF");
            if (cryptoIdx !== -1) {
              result[`${jsFile}__AES_CONTEXT`] = text.substring(Math.max(0, cryptoIdx - 2000), Math.min(text.length, cryptoIdx + 3000));
            }
          }
        } catch { /* skip */ }
      }
      
      result["found_js_files"] = foundFiles.join(", ") || "NONE";

      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: list-cgis - discover all CGI/ASP/DATA endpoints from router JS
    if (action === "list-cgis") {
      const allCgis: string[] = [];
      const contexts: Record<string, string> = {};
      try {
        const htmlRes = await fetch(`${baseUrl}/index.html`, { headers: { Cookie: cookie } });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const scriptPaths = [...html.matchAll(/(?:src|href)=["']?([^"'\s>]+\.js[^"'\s>]*)["']?/g)].map(m => m[1].replace(/^\.\//, "").replace(/^\//, ""));
          for (const jsPath of scriptPaths) {
            try {
              const jsRes = await fetch(`${baseUrl}/${jsPath}`, { headers: { Cookie: cookie } });
              if (!jsRes.ok) continue;
              const jsText = await jsRes.text();
              // Match .cgi, .data, and .asp endpoints
              const allMatches = [...jsText.matchAll(/["']([a-zA-Z0-9_]+\.(?:cgi|data|asp))["']/g)];
              for (const m of allMatches) {
                if (!allCgis.includes(m[1])) allCgis.push(m[1]);
                const idx = jsText.indexOf(m[1]);
                if (idx !== -1) {
                  contexts[m[1]] = jsText.substring(Math.max(0, idx - 200), Math.min(jsText.length, idx + 200));
                }
              }
              // Search for user save/add patterns
              const userSavePatterns = [...jsText.matchAll(/.{0,300}(?:saveUser|addUser|editUser|user.*\.asp|pppoe.*\.asp|setUser|userOperate)[^}]{0,500}/gi)];
              for (const m of userSavePatterns.slice(0, 8)) {
                contexts["__user_save_pattern_" + allCgis.length] = m[0].substring(0, 600);
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
      
      return new Response(JSON.stringify({ endpoints: allCgis, contexts }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: fetch-router-js - fetch JS files from router to analyze user add patterns
    if (action === "fetch-router-js") {
      const results: Record<string, string> = {};
      try {
        const htmlRes = await fetch(`${baseUrl}/index.html`, { headers: { Cookie: cookie } });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const scriptPaths = [...html.matchAll(/(?:src|href)=["']?([^"'\s>]+\.js[^"'\s>]*)["']?/g)].map(m => m[1].replace(/^\.\//, "").replace(/^\//, ""));
          
          // Also discover lazy-loaded chunk files from the main JS
          const additionalChunks: string[] = [];
          for (const jsPath of scriptPaths) {
            try {
              const jsRes = await fetch(`${baseUrl}/${jsPath}`, { headers: { Cookie: cookie } });
              if (!jsRes.ok) continue;
              const jsText = await jsRes.text();

              // Find lazy chunk references (webpackJsonp patterns)
              const chunkMatches = [...jsText.matchAll(/["']([a-f0-9]{4,8})["']/g)];
              // Find JS file references that look like chunk filenames
              const fileRefMatches = [...jsText.matchAll(/["'](static\/js\/[^"']+\.js)["']/g)];
              for (const m of fileRefMatches) {
                if (!scriptPaths.includes(m[1]) && !additionalChunks.includes(m[1])) {
                  additionalChunks.push(m[1]);
                }
              }

              // Search main scripts for patterns
              const patterns = [
                /\$postData[^;]{0,500}/gi,
                /postData[^;]{0,500}/gi,
                /userOperate[^}]{0,800}/gi,
                /opt\s*[:=]\s*["'](?:add|edit|del)[^}]{0,500}/gi,
                /pppoe[^}]{0,500}\.asp[^}]{0,300}/gi,
              ];
              for (const pat of patterns) {
                const matches = [...jsText.matchAll(pat)];
                for (const m of matches.slice(0, 5)) {
                  const key = `${jsPath}:${pat.source}:${m.index}`;
                  results[key] = m[0].substring(0, 800);
                }
              }
            } catch { /* skip */ }
          }

          // Log discovered chunk paths for reference
          results["additional_chunks"] = additionalChunks.slice(0, 10).join(", ");
        }
      } catch { /* skip */ }
      
      return new Response(JSON.stringify({ patterns: results }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: add-user - create a PPPoE user on the router via userfile.cgi
    if (action === "add-user") {
      const body = await req.json();
      const { usuario_pppoe, senha_pppoe, group } = body as { usuario_pppoe: string; senha_pppoe: string; group?: string };

      if (!usuario_pppoe || !senha_pppoe) {
        return new Response(JSON.stringify({ error: "usuario_pppoe e senha_pppoe são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get SN for encryption
      const [serialNumber, jsKey] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchKeyFromJS(baseUrl, cookie),
      ]);
      const effectiveSN = configSN || loginSN || serialNumber || jsKey;

      let encUser = usuario_pppoe;
      let encPwd = senha_pppoe;

      if (effectiveSN) {
        const { key, iv } = getRouterKeyIV(effectiveSN);
        const encryptField = (plain: string): string => {
          const encrypted = CryptoJS.AES.encrypt(plain, key, {
            iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding,
          });
          const innerB64 = encrypted.toString();
          const bytes = new TextEncoder().encode(innerB64);
          let binary = "";
          for (const b of bytes) binary += String.fromCharCode(b);
          return btoa(binary);
        };
        encUser = encryptField(usuario_pppoe);
        encPwd = encryptField(senha_pppoe);
      }

      // Build payload matching the router's user data structure
      // The router JS shows userOperate with opt field for operation type
      const userPayload = {
        opt: "add",
        user: encUser,
        pwd: encPwd,
        ips: "-",
        mac: " ",
        gid: 0,
        ddate: 0,
        state: 1,
        speed_up: 0,
        speed_down: 0,
        speed_mode: "dl",
        mod_pwd: "1",
        vlan: 0,
        group: group || "Default",
        vlan2: 0,
        ip_login: "",
        mac_login: "",
        bs_repeat_en: 0,
        bs_interval: 0,
        bs_count: 0,
        is_voucher: 0,
        pack_status: 0,
      };

      console.log(`R3005G ADD-USER: Adding "${usuario_pppoe}" to group "${group || "Default"}"`);

      // First, get current user count for verification
      let userCountBefore = 0;
      try {
        const beforeRes = await fetch(`${baseUrl}/user.data`, { headers: { Cookie: cookie } });
        if (beforeRes.ok) {
          const beforeJson = JSON.parse(await beforeRes.text());
          if (beforeJson.code === 0 && beforeJson.data?.all) {
            userCountBefore = beforeJson.data.all.length;
          }
        }
      } catch { /* skip */ }
      console.log(`R3005G ADD-USER: Users before: ${userCountBefore}`);

      // Intelbras routers use $postData to POST JSON to .asp endpoints for writes
      // .data endpoints are read-only. Pattern from JS: $postData("vpn_user.asp", { opt: "add", ... })
      const aspEndpoints = ["pppoe_user.asp", "user.asp", "pppoeBr_user.asp", "pppoe.asp", "pppoe_set.asp"];

      for (const ep of aspEndpoints) {
        try {
          console.log(`R3005G ADD-USER: Trying ${ep} (JSON), payload keys: ${Object.keys(userPayload).join(",")}`);
          
          const addRes = await fetch(`${baseUrl}/${ep}`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json;charset=UTF-8", 
              Cookie: cookie, 
              Origin: baseUrl, 
              Referer: `${baseUrl}/` 
            },
            body: JSON.stringify(userPayload),
          });

          const addText = await addRes.text();
          console.log(`R3005G ADD-USER: ${ep} => status=${addRes.status}, body=${addText.substring(0, 500)}`);

          if (addText.includes("Not Found") || addRes.status === 404) continue;

          let addJson: Record<string, unknown>;
          try { addJson = JSON.parse(addText); } catch { addJson = { raw: addText.substring(0, 500) }; }

          // Verify user was actually added by checking user count
          let userCountAfter = 0;
          try {
            const afterRes = await fetch(`${baseUrl}/user.data`, { headers: { Cookie: cookie } });
            if (afterRes.ok) {
              const afterJson = JSON.parse(await afterRes.text());
              if (afterJson.code === 0 && afterJson.data?.all) {
                userCountAfter = afterJson.data.all.length;
              }
            }
          } catch { /* skip */ }
          console.log(`R3005G ADD-USER: Users after ${ep}: ${userCountAfter} (before: ${userCountBefore})`);

          if (addJson.code === 0 && userCountAfter > userCountBefore) {
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Usuário ${usuario_pppoe} cadastrado no roteador (grupo: ${group || "Default"})`, 
              endpoint: ep, 
              usersBefore: userCountBefore,
              usersAfter: userCountAfter,
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // If JSON didn't work, also try form-urlencoded to .asp
          const formBody = Object.entries(userPayload).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
          const formRes = await fetch(`${baseUrl}/${ep}`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded", 
              Cookie: cookie, 
              Origin: baseUrl, 
              Referer: `${baseUrl}/` 
            },
            body: formBody,
          });

          const formText = await formRes.text();
          if (formText.includes("Not Found") || formRes.status === 404) continue;
          console.log(`R3005G ADD-USER: ${ep} (form) => status=${formRes.status}, body=${formText.substring(0, 500)}`);

          let formJson: Record<string, unknown>;
          try { formJson = JSON.parse(formText); } catch { formJson = { raw: formText.substring(0, 500) }; }

          // Re-check user count
          try {
            const afterRes2 = await fetch(`${baseUrl}/user.data`, { headers: { Cookie: cookie } });
            if (afterRes2.ok) {
              const afterJson2 = JSON.parse(await afterRes2.text());
              if (afterJson2.code === 0 && afterJson2.data?.all) {
                userCountAfter = afterJson2.data.all.length;
              }
            }
          } catch { /* skip */ }
          console.log(`R3005G ADD-USER: Users after ${ep} (form): ${userCountAfter} (before: ${userCountBefore})`);

          if (formJson.code === 0 && userCountAfter > userCountBefore) {
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Usuário ${usuario_pppoe} cadastrado no roteador (grupo: ${group || "Default"})`, 
              endpoint: ep + " (form)",
              usersBefore: userCountBefore,
              usersAfter: userCountAfter,
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.error(`R3005G ADD-USER: Error with ${ep}:`, e);
        }
      }

      // Fallback: try user.data POST (original approach) in case it works on some firmware versions
      try {
        const formBody = Object.entries(userPayload).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
        console.log(`R3005G ADD-USER: Fallback trying user.data (form)`);
        const fallbackRes = await fetch(`${baseUrl}/user.data`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie, Origin: baseUrl, Referer: `${baseUrl}/` },
          body: formBody,
        });
        const fallbackText = await fallbackRes.text();
        let fallbackJson: Record<string, unknown>;
        try { fallbackJson = JSON.parse(fallbackText); } catch { fallbackJson = {}; }
        const allUsers = (fallbackJson as any)?.data?.all;
        const userCountAfter = Array.isArray(allUsers) ? allUsers.length : 0;
        console.log(`R3005G ADD-USER: user.data fallback => Users after: ${userCountAfter} (before: ${userCountBefore})`);
        if (fallbackJson.code === 0 && userCountAfter > userCountBefore) {
          return new Response(JSON.stringify({ 
            success: true, message: `Usuário ${usuario_pppoe} cadastrado`, endpoint: "user.data",
            usersBefore: userCountBefore, usersAfter: userCountAfter,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch { /* skip */ }

      return new Response(JSON.stringify({ 
        success: false, 
        message: `Não foi possível cadastrar o usuário ${usuario_pppoe} no roteador. Tentados endpoints: ${aspEndpoints.join(", ")} e user.data. O número de usuários não aumentou (${userCountBefore}).`,
        usersBefore: userCountBefore,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("R3005G error:", err);
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
