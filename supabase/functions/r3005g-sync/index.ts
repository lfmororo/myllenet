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

// --- AES Decryption Logic ---

// Try to decrypt a double-base64 + AES-CBC encrypted value
function tryDecrypt(encryptedDoubleB64: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string | null {
  try {
    // First base64 decode to get the inner base64 (which is the actual ciphertext in base64)
    const innerB64 = atob(encryptedDoubleB64);
    
    // Decrypt using CryptoJS - innerB64 is already a base64 string of the ciphertext
    const decrypted = CryptoJS.AES.decrypt(innerB64, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.ZeroPadding,
    });
    
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    // Remove null bytes from zero padding
    const cleaned = result.replace(/\0/g, "").trim();
    
    if (cleaned && cleaned.length > 0) {
      return cleaned;
    }
  } catch {
    // silently fail
  }
  return null;
}

// Try multiple key derivation approaches
function getAllKeyApproaches(serialNumber: string): Array<{ name: string; key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray }> {
  const combined = serialNumber + AES_CONSTANT;
  const approaches = [];

  // Approach 1: MD5 of combined, first 16 bytes as key, same as IV
  const md5Hash = CryptoJS.MD5(combined);
  approaches.push({
    name: "MD5(sn+const) key=iv",
    key: CryptoJS.enc.Hex.parse(md5Hash.toString().substring(0, 32)),
    iv: CryptoJS.enc.Hex.parse(md5Hash.toString().substring(0, 32)),
  });

  // Approach 2: MD5 of combined as key, zero IV
  approaches.push({
    name: "MD5(sn+const) key, zero IV",
    key: CryptoJS.enc.Hex.parse(md5Hash.toString().substring(0, 32)),
    iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"),
  });

  // Approach 3: serial as key (padded to 16), constant first 16 as IV
  approaches.push({
    name: "serial as key, const as IV",
    key: CryptoJS.enc.Utf8.parse(serialNumber.padEnd(16, "\0").substring(0, 16)),
    iv: CryptoJS.enc.Utf8.parse(AES_CONSTANT.substring(0, 16)),
  });

  // Approach 4: constant first 16 as key, serial padded as IV
  approaches.push({
    name: "const as key, serial as IV",
    key: CryptoJS.enc.Utf8.parse(AES_CONSTANT.substring(0, 16)),
    iv: CryptoJS.enc.Utf8.parse(serialNumber.padEnd(16, "\0").substring(0, 16)),
  });

  // Approach 5: SHA256 of combined, split 16+16
  const sha256Hash = CryptoJS.SHA256(combined);
  const sha256Hex = sha256Hash.toString();
  approaches.push({
    name: "SHA256(sn+const) split",
    key: CryptoJS.enc.Hex.parse(sha256Hex.substring(0, 32)),
    iv: CryptoJS.enc.Hex.parse(sha256Hex.substring(32, 64)),
  });

  // Approach 6: MD5(serial) as key, MD5(constant) as IV
  const md5Serial = CryptoJS.MD5(serialNumber);
  const md5Const = CryptoJS.MD5(AES_CONSTANT);
  approaches.push({
    name: "MD5(serial) key, MD5(const) IV",
    key: CryptoJS.enc.Hex.parse(md5Serial.toString().substring(0, 32)),
    iv: CryptoJS.enc.Hex.parse(md5Const.toString().substring(0, 32)),
  });

  // Approach 7: reversed order - constant + serial
  const reverseCombined = AES_CONSTANT + serialNumber;
  const md5Reverse = CryptoJS.MD5(reverseCombined);
  approaches.push({
    name: "MD5(const+sn) key=iv",
    key: CryptoJS.enc.Hex.parse(md5Reverse.toString().substring(0, 32)),
    iv: CryptoJS.enc.Hex.parse(md5Reverse.toString().substring(0, 32)),
  });

  // Approach 8: first 16 of combined directly as key bytes, zero IV
  approaches.push({
    name: "combined[:16] as key, zero IV",
    key: CryptoJS.enc.Utf8.parse(combined.substring(0, 16)),
    iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"),
  });

  return approaches;
}

// --- Router API Functions ---

async function getRouterInfo(baseUrl: string): Promise<{ csrfprotect: string; captchaActive: boolean }> {
  let csrfprotect = Math.floor(Date.now() / 1000).toString();
  let captchaActive = false;
  try {
    const csrfRes = await fetch(`${baseUrl}/csrfprotect.data`);
    const csrfJson = await csrfRes.json();
    if (csrfJson?.data?.csrfprotect) csrfprotect = csrfJson.data.csrfprotect;
    if (csrfJson?.data?.code?.key && csrfJson.data.code.key !== "") captchaActive = true;
  } catch (e) {
    console.error("R3005G: Failed to fetch csrfprotect.data:", e);
  }
  return { csrfprotect, captchaActive };
}

async function loginR3005G(baseUrl: string, plainUser: string, plainPass: string): Promise<string> {
  const { csrfprotect, captchaActive } = await getRouterInfo(baseUrl);
  if (captchaActive) throw new Error("Router captcha ativo. Aguarde alguns minutos.");

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

// Fetch serial number from router
async function fetchSerialNumber(baseUrl: string, cookie: string): Promise<string | null> {
  const endpoints = [
    "sysinfo.data",
    "system_status.data",
    "device_info.data",
    "status.data",
    "system.data",
    "device.data",
    "wan.data",
    "lan.data",
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${baseUrl}/${ep}`, { headers: { Cookie: cookie } });
      if (!res.ok) continue;
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      
      let data = json.data;
      if (typeof data === "string") {
        try { data = JSON.parse(fromBase64(data)); } catch { /* keep */ }
      }
      if (!data || typeof data !== "object") continue;

      // Search for serial number fields
      const snFields = ["sn", "serial", "serial_number", "serialNumber", "device_sn", "SN", "serialNum"];
      for (const key of snFields) {
        if (data[key] && typeof data[key] === "string" && data[key].length > 4) {
          console.log(`R3005G: Found SN in ${ep}.${key}: ${data[key]}`);
          return data[key];
        }
      }
      
      // Check nested objects
      for (const [outerKey, val] of Object.entries(data)) {
        if (typeof val === "object" && val) {
          for (const key of snFields) {
            const v = (val as Record<string, unknown>)[key];
            if (v && typeof v === "string" && v.length > 4) {
              console.log(`R3005G: Found SN in ${ep}.${outerKey}.${key}: ${v}`);
              return v;
            }
          }
        }
      }

      // Log all keys for debugging
      console.log(`R3005G: ${ep} keys:`, Object.keys(data).join(", "));
    } catch { /* skip */ }
  }
  return null;
}

// Fetch raw users from router
async function fetchRawUsers(baseUrl: string, cookie: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/user.data`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`user.data failed: ${res.status}`);

  const json = await res.json();
  let userData = json.data;
  if (typeof json.data === "string") {
    try { userData = JSON.parse(fromBase64(json.data)); } catch { /* keep */ }
  }

  return userData?.all || userData?.list || (Array.isArray(userData) ? userData : []);
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // ACTION: discover - find serial number and test decryption
    if (action === "discover") {
      const [serialNumber, routerUsers] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      const firstUser = routerUsers[0] as Record<string, unknown> | undefined;
      const testEncrypted = firstUser?.user as string || "";
      
      console.log("R3005G DISCOVER: Serial Number:", serialNumber || "NOT FOUND");
      console.log("R3005G DISCOVER: First user raw:", JSON.stringify(firstUser, null, 2));

      // Test all decryption approaches if we have a serial
      const decryptionResults: Record<string, string | null> = {};
      if (serialNumber && testEncrypted) {
        const approaches = getAllKeyApproaches(serialNumber);
        for (const a of approaches) {
          const result = tryDecrypt(testEncrypted, a.key, a.iv);
          decryptionResults[a.name] = result;
          if (result) {
            console.log(`R3005G DISCOVER: ✅ Decryption SUCCESS with "${a.name}": "${result}"`);
          }
        }
      }

      return new Response(
        JSON.stringify({
          serial_number: serialNumber,
          total_users: routerUsers.length,
          first_user_encrypted: testEncrypted,
          decryption_results: decryptionResults,
          first_user_all_fields: firstUser ? Object.keys(firstUser) : [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ACTION: status - decrypt usernames and match with customers
    if (action === "status") {
      const [serialNumber, routerUsers] = await Promise.all([
        fetchSerialNumber(baseUrl, cookie),
        fetchRawUsers(baseUrl, cookie),
      ]);

      console.log(`R3005G STATUS: Serial=${serialNumber || "NOT FOUND"}, Router users=${routerUsers.length}`);

      // Find working decryption approach
      let workingApproach: { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray } | null = null;
      
      if (serialNumber) {
        const approaches = getAllKeyApproaches(serialNumber);
        const testEncrypted = (routerUsers[0] as Record<string, unknown>)?.user as string;
        
        if (testEncrypted) {
          for (const a of approaches) {
            const result = tryDecrypt(testEncrypted, a.key, a.iv);
            if (result && /^[a-zA-Z0-9._@\-]+$/.test(result)) {
              console.log(`R3005G STATUS: Using decryption approach "${a.name}", test result: "${result}"`);
              workingApproach = { key: a.key, iv: a.iv };
              break;
            }
          }
        }
      }

      // Build a map of decrypted router usernames -> router user data
      const routerUserMap = new Map<string, Record<string, unknown>>();
      
      for (const ru of routerUsers) {
        const ruObj = ru as Record<string, unknown>;
        const encUser = ruObj.user as string;
        
        if (encUser && workingApproach) {
          const decrypted = tryDecrypt(encUser, workingApproach.key, workingApproach.iv);
          if (decrypted) {
            routerUserMap.set(decrypted.toLowerCase(), ruObj);
          }
        }
      }

      console.log(`R3005G STATUS: Decrypted ${routerUserMap.size} of ${routerUsers.length} router usernames`);
      if (routerUserMap.size > 0) {
        console.log("R3005G STATUS: Sample decrypted usernames:", [...routerUserMap.keys()].slice(0, 5).join(", "));
      }

      const { data: customers } = await serviceClient
        .from("customers")
        .select("id, nome, usuario_pppoe, ativo");

      const customerPPPoEs = new Set((customers || []).map(c => c.usuario_pppoe?.toLowerCase()).filter(Boolean));

      const result = (customers || []).map((c) => {
        const pppoeUser = c.usuario_pppoe?.toLowerCase() || "";
        const routerMatch = routerUserMap.get(pppoeUser);

        return {
          id: c.id,
          nome: c.nome,
          usuario_pppoe: c.usuario_pppoe,
          ativo: c.ativo,
          online: routerMatch ? (routerMatch.cstate === 97) : false,
          found_in_router: !!routerMatch,
        };
      });

      // Users in router but not in system
      const notInSystem: Array<{ usuario_pppoe: string; online: boolean }> = [];
      for (const [username, ruObj] of routerUserMap) {
        if (!customerPPPoEs.has(username)) {
          notInSystem.push({
            usuario_pppoe: username,
            online: ruObj.cstate === 97,
          });
        }
      }

      const totalConnected = routerUsers.filter((u: Record<string, unknown>) => u.cstate === 97).length;

      return new Response(
        JSON.stringify({
          customers: result,
          not_in_system: notInSystem,
          total_router_users: routerUsers.length,
          total_connected: totalConnected,
          decryption_success: routerUserMap.size > 0,
          decrypted_count: routerUserMap.size,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "import") {
      return new Response(
        JSON.stringify({ error: "Use /status primeiro para verificar a descriptografia." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação desconhecida. Use /status ou /discover" }),
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
