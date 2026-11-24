// google-drive — conexão do backup com o Google Drive, pelo painel (Configurações → Backups)
//
//   GET  /google-drive/status        (admin)   situação: credenciais salvas? conectado? conta, pasta
//   POST /google-drive/credenciais   (admin)   { client_id, client_secret } do cliente OAuth do Google Cloud
//   POST /google-drive/conectar      (admin)   devolve a URL de autorização do Google
//   GET  /google-drive/callback      (público) o Google volta aqui com ?code&state; salva o refresh token
//   POST /google-drive/desconectar   (admin)   revoga e apaga a conexão
//   POST /google-drive/token         (interno) access token novo + id da pasta (usado pelo backup-diario.sh)
//
// Segredos (client_secret, refresh_token) ficam em public.integracoes, que o painel não lê
// (RLS sem policies; só a service role).
import { createClient } from "npm:@supabase/supabase-js@2";
import { exigir } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SCOPES = "openid email https://www.googleapis.com/auth/drive.file";
const PASTA_NOME = "MyLLENET Backups";
const PAINEL = Deno.env.get("PAINEL_URL") || "https://myllenet.mororo.tech";
const API_PUBLICA = (Deno.env.get("SUPABASE_PUBLIC_URL") || "https://api-myllenet.mororo.tech").replace(/\/+$/, "");
const REDIRECT_URI = `${API_PUBLICA}/functions/v1/google-drive/callback`;

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function ler(chave: string): Promise<any> {
  const { data } = await db().from("integracoes").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}
async function gravar(chave: string, valor: unknown) {
  const { error } = await db().from("integracoes").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  if (error) throw error;
}
async function apagar(chave: string) {
  await db().from("integracoes").delete().eq("chave", chave);
}

async function trocarToken(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google recusou (${r.status}): ${d.error_description || d.error || "erro"}`);
  return d;
}

async function accessToken(cfg: any): Promise<string> {
  const d = await trocarToken({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    refresh_token: cfg.refresh_token,
    grant_type: "refresh_token",
  });
  return d.access_token;
}

async function garantirPasta(at: string, cfg: any): Promise<string> {
  if (cfg.folder_id) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${cfg.folder_id}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${at}` },
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && !d.trashed) return cfg.folder_id;
  }
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: PASTA_NOME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`não consegui criar a pasta no Drive: ${JSON.stringify(d).slice(0, 200)}`);
  return d.id;
}

function paginaRetorno(ok: boolean, msg: string) {
  const url = `${PAINEL}/settings?aba=backups&drive=${ok ? "ok" : "erro"}&msg=${encodeURIComponent(msg)}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";

  try {
    // ---------- público: retorno do Google ----------
    if (rota === "callback") {
      const u = new URL(req.url);
      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      if (u.searchParams.get("error")) return paginaRetorno(false, "Autorização cancelada no Google");
      const st = await ler("google_drive_oauth_state");
      if (!st || st.state !== state || Date.now() > Number(st.expira)) {
        return paginaRetorno(false, "Link de autorização expirado; clique em Conectar de novo");
      }
      await apagar("google_drive_oauth_state");
      const cfg = (await ler("google_drive")) || {};
      const tok = await trocarToken({
        code,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      });
      if (!tok.refresh_token) {
        return paginaRetorno(false, "O Google não enviou o token de longa duração; remova o acesso em myaccount.google.com/permissions e conecte de novo");
      }
      let email = "";
      try {
        const p = JSON.parse(atob(String(tok.id_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        email = p.email || "";
      } catch { /* sem e-mail */ }
      const novo = { ...cfg, refresh_token: tok.refresh_token, email, conectado_em: new Date().toISOString(), conectado_por: st.user_id || null };
      novo.folder_id = await garantirPasta(tok.access_token, novo);
      await gravar("google_drive", novo);
      return paginaRetorno(true, `Google Drive conectado${email ? ` (${email})` : ""}`);
    }

    // ---------- interno: token para o backup ----------
    if (rota === "token") {
      const negado = await exigir(req, "interno");
      if (negado) return negado;
      const cfg = await ler("google_drive");
      if (!cfg?.refresh_token) return json({ conectado: false });
      const at = await accessToken(cfg);
      const pasta = await garantirPasta(at, cfg);
      if (pasta !== cfg.folder_id) await gravar("google_drive", { ...cfg, folder_id: pasta });
      return json({ conectado: true, access_token: at, folder_id: pasta, email: cfg.email || null });
    }

    // ---------- admin ----------
    const negado = await exigir(req, "admin");
    if (negado) return negado;

    if (rota === "status") {
      const cfg = (await ler("google_drive")) || {};
      return json({
        credenciais: !!(cfg.client_id && cfg.client_secret),
        client_id: cfg.client_id || null,
        conectado: !!cfg.refresh_token,
        email: cfg.email || null,
        pasta: cfg.folder_id ? PASTA_NOME : null,
        pasta_url: cfg.folder_id ? `https://drive.google.com/drive/folders/${cfg.folder_id}` : null,
        conectado_em: cfg.conectado_em || null,
        redirect_uri: REDIRECT_URI,
        origem_js: PAINEL,
      });
    }

    const body = await req.json().catch(() => ({}));

    if (rota === "credenciais") {
      const client_id = String(body.client_id || "").trim();
      const client_secret = String(body.client_secret || "").trim();
      if (!client_id.endsWith(".apps.googleusercontent.com")) return json({ error: "Client ID inválido (termina com .apps.googleusercontent.com)" }, 400);
      if (client_secret.length < 10) return json({ error: "Client secret inválido" }, 400);
      const cfg = (await ler("google_drive")) || {};
      const mudou = cfg.client_id && cfg.client_id !== client_id;
      await gravar("google_drive", mudou ? { client_id, client_secret } : { ...cfg, client_id, client_secret });
      return json({ ok: true, reconectar: !!mudou });
    }

    if (rota === "conectar") {
      const cfg = (await ler("google_drive")) || {};
      if (!cfg.client_id || !cfg.client_secret) return json({ error: "Salve primeiro o Client ID e o Client secret" }, 400);
      const state = crypto.randomUUID();
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await db().auth.getUser(token);
      await gravar("google_drive_oauth_state", { state, expira: Date.now() + 10 * 60 * 1000, user_id: u?.user?.id || null });
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", cfg.client_id);
      url.searchParams.set("redirect_uri", REDIRECT_URI);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", SCOPES);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);
      return json({ url: url.toString() });
    }

    if (rota === "desconectar") {
      const cfg = (await ler("google_drive")) || {};
      if (cfg.refresh_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cfg.refresh_token)}`, { method: "POST" }).catch(() => {});
      }
      const { refresh_token: _r, email: _e, folder_id: _f, conectado_em: _c, conectado_por: _p, ...resto } = cfg;
      await gravar("google_drive", resto);
      return json({ ok: true });
    }

    return json({ error: "rota inválida" }, 404);
  } catch (e) {
    console.error("google-drive", e);
    if (rota === "callback") return paginaRetorno(false, (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
