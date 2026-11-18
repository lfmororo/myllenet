// FUNÇÃO TEMPORÁRIA — myllenet-export
// Usada UMA vez para a migração da Lovable Cloud para a VPS e apagada logo depois.
// Devolve a URL do banco e os segredos das Edge Functions, protegidos por uma chave.
//
// Antes de publicar, troque TROQUE_PELA_CHAVE pela chave gerada na VPS com:
//   openssl rand -hex 24
// A chave fica só no seu terminal da VPS e neste arquivo; nunca a envie por chat.

const EXPORT_KEY = "TROQUE_PELA_CHAVE";

const SECRET_NAMES = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AGENTE_TOKEN",
  "AGENTE_WEBHOOK_URL",
  "CRON_SECRET",
  "EFI_CLIENT_ID",
  "EFI_CLIENT_SECRET",
  "EVOLUTION_API_KEY",
  "EVOLUTION_BASE_URL",
  "EVOLUTION_INSTANCE",
  "MERCADOPAGO_ACCESS_TOKEN",
  "UAZAPI_TOKEN",
  "WHATSAPP_PROVIDER",
];

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve((req) => {
  const key = req.headers.get("x-export-key") ?? "";
  if (EXPORT_KEY === "TROQUE_PELA_CHAVE" || EXPORT_KEY.length < 32 || !timingSafeEqual(key, EXPORT_KEY)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const out: Record<string, string | null> = {};
  for (const name of SECRET_NAMES) out[name] = Deno.env.get(name) ?? null;
  return new Response(JSON.stringify(out), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
