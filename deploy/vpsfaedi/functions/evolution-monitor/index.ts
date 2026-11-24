import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { waSendText } from "../_shared/whatsapp.ts";
import { exigir } from "../_shared/auth.ts";

const ADMIN_PHONE = "85986801458";
const STATE_KEY = "evolution_instance_states";

function isConnected(state: string) {
  return String(state || "").toLowerCase() === "open";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const negado = await exigir(req, "interno");
  if (negado) return negado;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: rows } = await supabase
      .from("settings")
      .select("key,value")
      .in("key", ["evolution_base_url", "evolution_api_key", STATE_KEY]);

    const cfg: Record<string, string> = {};
    for (const r of rows ?? []) cfg[r.key] = r.value ?? "";

    const baseUrl = (cfg.evolution_base_url || "").replace(/\/+$/, "");
    const apiKey = cfg.evolution_api_key || "";

    if (!baseUrl || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Evolution API não configurada (URL e API Key em Configurações > WhatsApp)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Evolution API [${res.status}]: ${text.slice(0, 300)}`);
    }

    let list: any[] = [];
    try {
      const parsed = JSON.parse(text);
      list = Array.isArray(parsed) ? parsed : (parsed?.instances || []);
    } catch {
      throw new Error("Resposta inesperada da Evolution API");
    }

    let previous: Record<string, string> = {};
    try { previous = JSON.parse(cfg[STATE_KEY] || "{}"); } catch { previous = {}; }

    const current: Record<string, string> = {};
    const changes: { name: string; state: string; wasConnected: boolean }[] = [];

    for (const item of list) {
      const inst = item?.instance || item;
      const name = inst?.instanceName || inst?.name || inst?.id;
      if (!name) continue;
      const state = inst?.connectionStatus || inst?.state || inst?.status || "unknown";
      current[name] = state;

      const prev = previous[name];
      if (prev === undefined) continue; // primeira leitura: só registra
      if (isConnected(prev) !== isConnected(state)) {
        changes.push({ name, state, wasConnected: isConnected(prev) });
      }
    }

    for (const change of changes) {
      const message = change.wasConnected
        ? `🔴 *Evolution API - Instância desconectada*\n\n📱 Instância: *${change.name}*\n⚠️ Status: ${change.state}\n🕒 ${new Date(Date.now() - 3 * 3600 * 1000).toLocaleString("pt-BR")}\n\nVerifique e reconecte o WhatsApp desta instância.`
        : `🟢 *Evolution API - Instância reconectada*\n\n📱 Instância: *${change.name}*\n✅ Status: ${change.state}\n🕒 ${new Date(Date.now() - 3 * 3600 * 1000).toLocaleString("pt-BR")}`;

      try {
        await waSendText(ADMIN_PHONE, message);
      } catch (err) {
        console.error(`Falha ao notificar mudança da instância ${change.name}:`, err);
      }
    }

    await supabase
      .from("settings")
      .upsert({ key: STATE_KEY, value: JSON.stringify(current) }, { onConflict: "key" });

    return new Response(
      JSON.stringify({ success: true, instances: Object.keys(current).length, changes, states: current }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("evolution-monitor error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
