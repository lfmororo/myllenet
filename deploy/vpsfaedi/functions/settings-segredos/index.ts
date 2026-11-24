// settings-segredos — grava credenciais sem nunca devolvê-las ao navegador (só admin)
//   GET  /settings-segredos            → { configurado: { chave: true|false } }
//   POST /settings-segredos {chave, valor}  → grava (valor vazio = apaga)
// As linhas continuam na tabela settings (as functions leem com a service role), mas o
// RLS esconde essas chaves de qualquer usuário do painel.
import { createClient } from "npm:@supabase/supabase-js@2";
import { exigir } from "../_shared/auth.ts";

export const SEGREDOS = [
  "efi_client_id",
  "efi_client_secret",
  "mercadopago_access_token",
  "uazapi_token",
  "evolution_api_key",
  "mikrotik_password",
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const negado = await exigir(req, "admin");
  if (negado) return negado;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (req.method === "GET") {
      const { data } = await db.from("settings").select("key, value").in("key", SEGREDOS);
      const configurado: Record<string, boolean> = {};
      for (const k of SEGREDOS) configurado[k] = false;
      for (const r of data || []) configurado[r.key] = !!(r.value && String(r.value).trim());
      return json({ configurado });
    }
    const { chave, valor } = await req.json().catch(() => ({}));
    if (!SEGREDOS.includes(String(chave))) return json({ error: "chave não permitida" }, 400);
    const v = String(valor ?? "").trim();
    const { data: existe } = await db.from("settings").select("key").eq("key", chave).maybeSingle();
    const { error } = existe
      ? await db.from("settings").update({ value: v }).eq("key", chave)
      : await db.from("settings").insert({ key: chave, value: v });
    if (error) throw error;
    return json({ ok: true, configurado: !!v });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
