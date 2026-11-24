// aviso-admin — envia um texto para todos os administradores (settings.admin_whatsapp) pela Evolution API
//   POST { "texto": "...", "tipo": "admin_backup" }   (só interno: service key ou x-cron-secret)
// Usado pelo backup diário e por verificações agendadas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getWhatsAppConfig, waSendText } from "../_shared/whatsapp.ts";
import { exigir } from "../_shared/auth.ts";

const ADMIN_PADRAO = "85986801458";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const negado = await exigir(req, "interno");
  if (negado) return negado;
  try {
    const body = await req.json().catch(() => ({}));
    const texto = String(body?.texto || "").trim();
    const tipo = String(body?.tipo || "admin_aviso").slice(0, 60);
    if (!texto) return json({ error: "texto obrigatório" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await supabase.from("settings").select("value").eq("key", "admin_whatsapp").maybeSingle();
    const lista = String(data?.value || "").split(/[,;\s\n]+/).map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 10);
    const fones = lista.length ? [...new Set(lista)] : [ADMIN_PADRAO];

    const cfg = await getWhatsAppConfig();
    if (cfg.evolutionBaseUrl && cfg.evolutionApiKey && cfg.evolutionInstance) cfg.provider = "evolution";

    let enviados = 0;
    for (const fone of fones) {
      let erro: string | null = null;
      try { await waSendText(fone, texto, cfg); enviados++; } catch (e) { erro = (e as Error).message; }
      await supabase.from("notification_logs").insert({
        customer_name: "Administradores", phone: fone, type: tipo, message: texto,
        status: erro ? "failed" : "sent", error_message: erro,
      });
    }
    return json({ ok: true, enviados, administradores: fones.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
