// Controle de acesso das Edge Functions (vpsfaedi)
//
//   const negado = await exigir(req, "interno");   // só cron / outra function (service key ou x-cron-secret)
//   const negado = await exigir(req, "usuario");   // interno ou qualquer usuário logado do painel
//   const negado = await exigir(req, "admin");     // interno ou usuário com papel admin
//   if (negado) return negado;
//
// A chave anônima (pública, está no JavaScript do painel) nunca passa.
// Um JWT só é aceito depois de validado pelo Auth (assinatura conferida), nunca só decodificado.
import { createClient } from "npm:@supabase/supabase-js@2";

export type Nivel = "interno" | "usuario" | "admin";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function negar(status: number, erro: string) {
  return new Response(JSON.stringify({ error: erro }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function ehInterno(req: Request): boolean {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cron = Deno.env.get("CRON_SECRET") || "";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (service && token === service) return true;
  const enviado = req.headers.get("x-cron-secret") || "";
  return !!cron && enviado === cron;
}

/** Devolve uma Response 401/403 se o chamador não tiver o nível pedido; null se pode seguir. */
export async function exigir(req: Request, nivel: Nivel): Promise<Response | null> {
  if (ehInterno(req)) return null;
  if (nivel === "interno") return negar(401, "não autorizado");

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return negar(401, "não autorizado");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return negar(401, "não autorizado");
  if (nivel === "usuario") return null;

  const { data: papel } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();
  return papel ? null : negar(403, "somente administradores");
}
