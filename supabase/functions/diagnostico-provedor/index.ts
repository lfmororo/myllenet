import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const expected = Deno.env.get("AGENTE_TOKEN") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!expected || !token || !safeEqual(token, expected)) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("cliente_id") ?? "";
      if (!UUID.test(id)) return json({ error: "cliente_id inválido" }, 400);
      const { data } = await sb.from("customers").select("id, usuario_pppoe").eq("id", id).maybeSingle();
      if (!data) return json({ error: "Cliente não encontrado" }, 404);
      return json({ cliente_id: data.id, login_pppoe: data.usuario_pppoe });
    }

    if (req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: "JSON inválido" }, 400);
      }
      if (!body || typeof body !== "object") return json({ error: "Body inválido" }, 400);
      const { diagnostico_id, cliente_id } = body;
      if (!UUID.test(String(cliente_id ?? ""))) return json({ error: "cliente_id inválido" }, 400);
      if (diagnostico_id != null && !UUID.test(String(diagnostico_id))) return json({ error: "diagnostico_id inválido" }, 400);
      if (JSON.stringify(body).length > 200_000) return json({ error: "Body muito grande" }, 413);

      const { data: cli } = await sb.from("customers").select("id").eq("id", cliente_id).maybeSingle();
      if (!cli) return json({ error: "Cliente não encontrado" }, 404);

      const ping = body.ping ?? {};
      const perda = num(ping.perda_pct);
      const media = num(ping.media_ms);
      const online = body.pppoe?.online;
      const veredito =
        online === false || (perda ?? 0) >= 20 ? "falha" : (perda ?? 0) > 0 || (media ?? 0) > 50 ? "alerta" : "ok";

      const { data, error } = await sb
        .from("diagnosticos")
        .insert({
          cliente_id,
          origem: "provedor",
          dados: { ...body, diagnostico_origem_id: diagnostico_id ?? null },
          latencia_ms: media,
          perda_pct: perda,
          veredito,
          ip_publico: typeof body.pppoe?.ip === "string" ? body.pppoe.ip : null,
          na_rede_provedor: online === true ? true : online === false ? false : null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return json({ ok: true, id: data.id, protocolo: data.id.slice(0, 8).toUpperCase(), veredito });
    }

    return json({ error: "Método não permitido" }, 405);
  } catch (e) {
    console.error("diagnostico-provedor", e);
    return json({ error: "Erro interno" }, 500);
  }
});
