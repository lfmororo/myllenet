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

// Try to AES decrypt using hex output to avoid UTF-8 errors, then convert manually
function aesDecryptSafe(cipherBase64: string, keyStr: string, ivStr: string): string | null {
  try {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
    
    // Try ZeroPadding first
    const decrypted = CryptoJS.AES.decrypt(
      cipherBase64,
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding }
    );
    
    // Get as hex (avoids UTF-8 conversion errors)
    const hex = decrypted.toString();
    if (!hex || hex.length === 0) return null;
    
    // Convert hex to bytes
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    
    // Remove zero padding bytes
    while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
    if (bytes.length === 0) return null;
    
    // Check if all bytes are printable ASCII (valid username/password chars)
    if (bytes.every(b => b >= 32 && b < 127)) {
      return String.fromCharCode(...bytes);
    }
    
    return null;
  } catch {
    return null;
  }
}

// Generate all possible key derivation approaches to find the right one
function getAllKeyDerivations(sn: string): Array<{ name: string; keyStr: string; ivStr: string }> {
  const approaches: Array<{ name: string; keyStr: string; ivStr: string }> = [];
  
  // 1. Original: base64(SN) + constant
  const combined1 = toBase64(sn) + AES_CONSTANT;
  approaches.push({ name: "base64(SN)+const", keyStr: combined1.slice(0, 16), ivStr: combined1.slice(16, 32) });
  
  // 2. Empty SN (constant only)
  approaches.push({ name: "const_only", keyStr: AES_CONSTANT.slice(0, 16), ivStr: AES_CONSTANT.slice(16, 32) });
  
  // 3. SN directly (no base64) + constant
  const combined3 = sn + AES_CONSTANT;
  approaches.push({ name: "SN+const", keyStr: combined3.slice(0, 16), ivStr: combined3.slice(16, 32) });
  
  // 4. constant + base64(SN)
  const combined4 = AES_CONSTANT + toBase64(sn);
  approaches.push({ name: "const+base64(SN)", keyStr: combined4.slice(0, 16), ivStr: combined4.slice(16, 32) });
  
  // 5. constant + SN
  const combined5 = AES_CONSTANT + sn;
  approaches.push({ name: "const+SN", keyStr: combined5.slice(0, 16), ivStr: combined5.slice(16, 32) });

  // 6. base64(SN) only padded
  const b64sn = toBase64(sn);
  if (b64sn.length >= 32) {
    approaches.push({ name: "base64(SN)_only", keyStr: b64sn.slice(0, 16), ivStr: b64sn.slice(16, 32) });
  }
  
  return approaches;
}

// Find the working key derivation by testing against a sample encrypted value
function findWorkingDecryption(sampleCipher: string, sn: string): { keyStr: string; ivStr: string; name: string } | null {
  const approaches = getAllKeyDerivations(sn);
  
  for (const approach of approaches) {
    const result = aesDecryptSafe(sampleCipher, approach.keyStr, approach.ivStr);
    if (result) {
      console.log(`R3005G: Decryption works with approach "${approach.name}" → "${result}"`);
      return approach;
    }
  }
  
  return null;
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

async function getRouterInfo(baseUrl: string): Promise<{ sn: string; gwsn: string; allSn: Record<string, string>; csrfprotect: string; captchaActive: boolean }> {
  let sn = "";
  let gwsn = "";
  let allSn: Record<string, string> = {};
  try {
    const baseRes = await fetch(`${baseUrl}/base_mini.data`);
    const baseJson = await baseRes.json();
    if (baseJson?.data) {
      const decoded = JSON.parse(fromBase64(baseJson.data));
      gwsn = decoded.gwsn || "";
      sn = decoded.sn || "";
      // Log ALL fields to find any other serial number
      allSn = decoded;
      console.log("R3005G: base_mini.data decoded:", JSON.stringify(decoded));
    }
  } catch (e) {
    console.error("R3005G: Failed to fetch base_mini.data:", e);
  }

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

  return { sn: gwsn || sn, gwsn, allSn, csrfprotect, captchaActive };
}

async function loginR3005G(
  baseUrl: string,
  plainUser: string,
  plainPass: string
): Promise<string> {
  const { csrfprotect, captchaActive } = await getRouterInfo(baseUrl);

  if (captchaActive) {
    throw new Error("Router captcha is active. Please wait a few minutes or manually log in via browser to reset.");
  }

  const encodedUser = encodeCredential(plainUser);
  const encodedPass = encodeCredential(plainPass);

  const payload = {
    csrfprotect,
    user: encodedUser,
    password: encodedPass,
    base64: 1,
    tm: Date.now() / 1000,
  };

  console.log("R3005G login payload:", JSON.stringify({ ...payload, password: "***" }));

  const res = await fetch(`${baseUrl}/log_in.cgi`, {
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

interface RouterUserRaw {
  user: string;
  pwd: string;
  cstate: number;
  gid: number;
  enable?: number;
  state?: number;
  ips?: string;
  ip_login?: string;
  mac_login?: string;
}

async function fetchPPPoEUsers(
  baseUrl: string,
  cookie: string
): Promise<RouterUserRaw[]> {
  const res = await fetch(`${baseUrl}/user.data`, {
    headers: { Cookie: cookie },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch users: ${res.status} - ${text}`);
  }

  const json = await res.json();

  let userData = json.data;
  if (typeof json.data === "string") {
    try {
      userData = JSON.parse(fromBase64(json.data));
    } catch (e) {
      console.error("R3005G: failed to decode base64 data:", e);
    }
  }

  if (json.code !== 0) {
    throw new Error(`Unexpected response code: ${json.code}`);
  }

  const users = userData?.all || userData?.list || userData;
  if (!Array.isArray(users)) {
    console.log("R3005G: userData sample:", JSON.stringify(userData).substring(0, 500));
    throw new Error(`Could not find users array in response`);
  }

  if (users.length > 0) {
    const sample = users[0];
    console.log("R3005G: raw user fields:", JSON.stringify(Object.keys(sample)));
    console.log("R3005G: raw user[0]:", JSON.stringify({ 
      user: sample.user?.substring(0, 30), 
      cstate: sample.cstate, 
      state: sample.state,
      enable: sample.enable, 
      ips: sample.ips,
      ip_login: sample.ip_login,
      mac_login: sample.mac_login 
    }));
  }

  return users;
}

async function togglePPPoEUser(
  baseUrl: string,
  cookie: string,
  csrfprotect: string,
  targetUser: string,
  enable: boolean
): Promise<{ success: boolean; message: string }> {
  const endpoints = [
    { url: `${baseUrl}/config.data?csrfprotect=${csrfprotect}`, body: { module: "pppoe_server", action: "set_user_status", data: { user: targetUser, enable: enable ? 1 : 0 } } },
    { url: `${baseUrl}/user.data?csrfprotect=${csrfprotect}`, body: { action: "set", data: { user: targetUser, enable: enable ? 1 : 0 } } },
  ];

  for (const ep of endpoints) {
    try {
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

// Encrypt a plaintext username with given key/IV to match against router's encrypted data
function aesEncryptForMatch(plaintext: string, keyStr: string, ivStr: string): string {
  try {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
    const encrypted = CryptoJS.AES.encrypt(
      CryptoJS.enc.Utf8.parse(plaintext),
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.ZeroPadding }
    );
    return encrypted.toString();
  } catch {
    return "";
  }
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
        JSON.stringify({ error: "R3005G não configurado. Vá em Configurações > R3005G para definir URL e credenciais." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const urlObj = new URL(req.url);
    const action = urlObj.pathname.split("/").pop();

    if (action === "debug") {
      const results: Record<string, string> = {};
      
      // Fetch the chunk-common JS to find the actual encryption code
      const jsFiles = [
        "static/js/chunk-common.b1df80ed.js",
        "static/js/login.a8237273.js"
      ];
      
      for (const jsFile of jsFiles) {
        try {
          const jsRes = await fetch(`${baseUrl}/${jsFile}`);
          if (jsRes.ok) {
            const js = await jsRes.text();
            results[`${jsFile}_size`] = js.length.toString();
            for (const term of ["getEncryptionData", "deCode", "enCode", "AES", "encrypt", "decrypt", "ZeroPadding", "Pkcs7", "CBC", "gwsn", "serial"]) {
              const idx = js.indexOf(term);
              if (idx >= 0) {
                const start = Math.max(0, idx - 200);
                const end = Math.min(js.length, idx + 600);
                results[`${jsFile}__${term}_at_${idx}`] = js.substring(start, end);
              }
            }
          }
        } catch (e) { results[`${jsFile}_error`] = (e as Error).message; }
      }

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get router info (SN, etc.)
    const routerInfo = await getRouterInfo(baseUrl);
    const cookie = await loginR3005G(baseUrl, routerUser, routerPass);

    // Fetch all PPPoE users from router
    const routerUsers = await fetchPPPoEUsers(baseUrl, cookie);

    // Try to find working decryption by testing all key derivations
    let workingDecryption: { keyStr: string; ivStr: string; name: string } | null = null;
    
    if (routerUsers.length > 0) {
      const sampleCipher = routerUsers[0].user;
      
      // Try with gwsn
      workingDecryption = findWorkingDecryption(sampleCipher, routerInfo.gwsn);
      
      // Try with sn if gwsn didn't work
      if (!workingDecryption && routerInfo.allSn.sn && routerInfo.allSn.sn !== routerInfo.gwsn) {
        console.log("R3005G: gwsn didn't work, trying sn:", routerInfo.allSn.sn);
        workingDecryption = findWorkingDecryption(sampleCipher, routerInfo.allSn.sn);
      }
      
      // Try with empty SN
      if (!workingDecryption) {
        console.log("R3005G: trying empty SN");
        workingDecryption = findWorkingDecryption(sampleCipher, "");
      }
      
      if (workingDecryption) {
        console.log(`R3005G: Found working decryption: ${workingDecryption.name}`);
      } else {
        console.log("R3005G: No working decryption found, will use encrypt-and-compare strategy");
        // Log all approaches tried for debugging
        const approaches = getAllKeyDerivations(routerInfo.sn);
        for (const a of approaches) {
          console.log(`R3005G: tried "${a.name}" key=${a.keyStr} iv=${a.ivStr}`);
        }
      }
    }

    if (action === "status") {
      const { data: customers } = await serviceClient
        .from("customers")
        .select("id, nome, usuario_pppoe, ativo");

      if (workingDecryption) {
        // STRATEGY 1: Decrypt router usernames and match
        const { keyStr, ivStr } = workingDecryption;
        
        const decodedUsers = routerUsers.map((u) => ({
          usuario_pppoe: aesDecryptSafe(u.user, keyStr, ivStr) || u.user,
          senha_pppoe: aesDecryptSafe(u.pwd, keyStr, ivStr) || u.pwd,
          cstate: u.cstate,
          connected: u.cstate === 97,
          enable: u.enable,
        }));

        console.log("R3005G: decoded first 5:", decodedUsers.slice(0, 5).map(u => ({ user: u.usuario_pppoe, cstate: u.cstate, connected: u.connected })));

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
            decryption_method: workingDecryption.name,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // STRATEGY 2: Encrypt-and-compare (encrypt known usernames, compare with router data)
        // Try ALL key derivation approaches for encrypt-and-compare
        const allApproaches = [
          ...getAllKeyDerivations(routerInfo.gwsn),
          ...(routerInfo.allSn.sn && routerInfo.allSn.sn !== routerInfo.gwsn 
            ? getAllKeyDerivations(routerInfo.allSn.sn) : []),
          ...getAllKeyDerivations(""),
        ];
        
        // For each approach, try encrypting a known customer username and see if it matches any router user
        let matchingApproach: { keyStr: string; ivStr: string; name: string } | null = null;
        
        const testCustomers = (customers || []).slice(0, 5);
        const routerUserSet = new Set(routerUsers.map(u => u.user));
        
        for (const approach of allApproaches) {
          for (const c of testCustomers) {
            if (!c.usuario_pppoe) continue;
            const encrypted = aesEncryptForMatch(c.usuario_pppoe, approach.keyStr, approach.ivStr);
            if (encrypted && routerUserSet.has(encrypted)) {
              matchingApproach = approach;
              console.log(`R3005G: Encrypt-and-compare works with "${approach.name}" for user "${c.usuario_pppoe}" → "${encrypted.substring(0, 20)}..."`);
              break;
            }
          }
          if (matchingApproach) break;
        }

        if (matchingApproach) {
          // Build map: encrypted username → router user data
          const { keyStr, ivStr } = matchingApproach;
          
          const result = (customers || []).map((c) => {
            if (!c.usuario_pppoe) return { id: c.id, nome: c.nome, usuario_pppoe: c.usuario_pppoe, ativo: c.ativo, online: false, found_in_router: false };
            
            const encrypted = aesEncryptForMatch(c.usuario_pppoe, keyStr, ivStr);
            const routerUser = routerUsers.find(u => u.user === encrypted);
            
            return {
              id: c.id,
              nome: c.nome,
              usuario_pppoe: c.usuario_pppoe,
              ativo: c.ativo,
              online: routerUser ? routerUser.cstate === 97 : false,
              found_in_router: !!routerUser,
            };
          });

          // For not_in_system, find router users not matched by any customer
          const matchedEncrypted = new Set(
            (customers || []).filter(c => c.usuario_pppoe).map(c => aesEncryptForMatch(c.usuario_pppoe!, keyStr, ivStr))
          );
          
          const notInSystem = routerUsers
            .filter(u => !matchedEncrypted.has(u.user))
            .map(u => ({
              usuario_pppoe: aesDecryptSafe(u.user, keyStr, ivStr) || `[encrypted:${u.user.substring(0, 15)}...]`,
              senha_pppoe: aesDecryptSafe(u.pwd, keyStr, ivStr) || "[encrypted]",
              online: u.cstate === 97,
            }));

          return new Response(
            JSON.stringify({
              customers: result,
              not_in_system: notInSystem,
              total_router_users: routerUsers.length,
              total_connected: routerUsers.filter(u => u.cstate === 97).length,
              decryption_method: `encrypt-compare:${matchingApproach.name}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // STRATEGY 3: No matching possible - return raw data with cstate for debugging
        console.log("R3005G: WARNING - No decryption or encryption matching worked!");
        console.log("R3005G: First 3 encrypted users:", routerUsers.slice(0, 3).map(u => u.user));
        console.log("R3005G: First 3 DB users:", testCustomers.map(c => c.usuario_pppoe));
        
        // Still try to match by other means - check if any usernames appear unencrypted
        const routerUsernameSet = new Set(routerUsers.map(u => u.user.toLowerCase()));
        
        const result = (customers || []).map((c) => {
          // Try direct match (in case data is actually plain text)
          const directMatch = routerUsers.find(u => u.user.toLowerCase() === c.usuario_pppoe?.toLowerCase());
          
          return {
            id: c.id,
            nome: c.nome,
            usuario_pppoe: c.usuario_pppoe,
            ativo: c.ativo,
            online: directMatch ? directMatch.cstate === 97 : false,
            found_in_router: !!directMatch,
          };
        });

        return new Response(
          JSON.stringify({
            customers: result,
            not_in_system: [],
            total_router_users: routerUsers.length,
            total_connected: routerUsers.filter(u => u.cstate === 97).length,
            decryption_method: "none_found",
            debug: {
              sn: routerInfo.sn,
              gwsn: routerInfo.gwsn,
              sample_encrypted: routerUsers[0]?.user,
              sample_cstate: routerUsers[0]?.cstate,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (action === "import") {
      // For import, we need to decrypt usernames
      if (!workingDecryption) {
        return new Response(
          JSON.stringify({ error: "Não foi possível descriptografar os dados do roteador. Verifique nos logs." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { keyStr, ivStr } = workingDecryption;
      const { data: customers } = await serviceClient
        .from("customers")
        .select("usuario_pppoe");

      const existing = new Set(
        (customers || []).map((c) => c.usuario_pppoe?.toLowerCase())
      );

      const decodedUsers = routerUsers.map(u => ({
        usuario_pppoe: aesDecryptSafe(u.user, keyStr, ivStr) || u.user,
        senha_pppoe: aesDecryptSafe(u.pwd, keyStr, ivStr) || u.pwd,
        connected: u.cstate === 97,
      }));

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
