import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = req.headers.get("x-agent-token") || "";
    if (!token)
      return json({ success: false, error: "Token do agente ausente" }, 401);

    const { data: agent } = await supabase
      .from("agent_tokens")
      .select("id, active, name")
      .eq("token", token)
      .maybeSingle();

    if (!agent || !agent.active)
      return json({ success: false, error: "Token inválido ou inativo" }, 401);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

    await supabase
      .from("agent_tokens")
      .update({ last_seen_at: new Date().toISOString(), last_ip: ip })
      .eq("id", agent.id);

    const body = await req.json().catch(() => ({}));

    // --- Command queue: report results of previously claimed commands ---
    if (Array.isArray(body?.command_results)) {
      for (const r of body.command_results) {
        if (!r?.id) continue;
        await supabase
          .from("mikrotik_commands")
          .update({
            status: r.success ? "done" : "error",
            error_message: r.success ? null : String(r.error || "Falha"),
            result: r.result ?? null,
            executed_at: new Date().toISOString(),
          })
          .eq("id", r.id);
      }
    }

    // --- Command queue: hand out pending commands for the agent to run ---
    if (body?.commands_poll) {
      const { data: pending } = await supabase
        .from("mikrotik_commands")
        .select("*")
        .in("status", ["pending", "running"])
        .lt("attempts", 5)
        .order("created_at", { ascending: true })
        .limit(20);

      const commands = [] as any[];
      for (const c of pending || []) {
        await supabase
          .from("mikrotik_commands")
          .update({ status: "running", attempts: (c.attempts || 0) + 1 })
          .eq("id", c.id);
        commands.push({
          id: c.id,
          action: c.action,
          usuario_pppoe: c.usuario_pppoe,
          payload: c.payload || {},
        });
      }

      return json({ success: true, commands });
    }

    // Support batched payloads: { batch: [payload, payload, ...] } or a single payload
    const payloads: any[] = Array.isArray(body?.batch) ? body.batch : [body];

    const result = {
      wan: 0,
      speedtests: 0,
      pppoe: 0,
      status: 0,
      unknown_pppoe: [] as string[],
    };

    // Cache PPPoE -> customer id
    const { data: customers } = await supabase
      .from("customers")
      .select("id, usuario_pppoe")
      .not("usuario_pppoe", "is", null);

    const customerMap = new Map<string, string>();
    customers?.forEach((c: any) =>
      customerMap.set(String(c.usuario_pppoe).toLowerCase(), c.id),
    );

    for (const p of payloads) {
      const loggedAt = p.collected_at || new Date().toISOString();
      const resource = p.resource || {};

      // 1. Router reachability history
      if (p.host) {
        await supabase.from("mikrotik_status_history").insert({
          host: p.host,
          online: p.online !== false,
          message:
            p.message ||
            (p.online === false
              ? "Agente VPS: sem resposta"
              : "Agente VPS: OK"),
          logged_at: loggedAt,
          diagnostics: p.diagnostics || null,
        });

        // Sincroniza o status global para o painel de hosts
        await supabase.from("mikrotik_status_history").upsert(
          {
            host: p.host,
            online: p.online !== false,
            message:
              p.message ||
              (p.online === false
                ? "Agente VPS: sem resposta"
                : "Agente VPS: OK"),
            created_at: loggedAt,
            diagnostics: p.diagnostics || null,
          },
          { onConflict: "host" },
        );

        result.status++;
      }

      // 2. WAN traffic + hardware metrics
      if (Array.isArray(p.wan) && p.wan.length > 0) {
        const rows = p.wan.map((w: any) => ({
          interface_name: String(w.interface_name),
          rx_bps: Math.max(0, Math.round(Number(w.rx_bps) || 0)),
          tx_bps: Math.max(0, Math.round(Number(w.tx_bps) || 0)),
          rx_bytes: w.rx_bytes != null ? Number(w.rx_bytes) : null,
          tx_bytes: w.tx_bytes != null ? Number(w.tx_bytes) : null,
          cpu_load:
            resource.cpu_load != null ? Number(resource.cpu_load) : null,
          free_memory:
            resource.free_memory != null ? Number(resource.free_memory) : null,
          total_memory:
            resource.total_memory != null
              ? Number(resource.total_memory)
              : null,
          temperature:
            resource.temperature != null ? Number(resource.temperature) : null,
          created_at: loggedAt,
        }));
        const { error } = await supabase.from("wan_logs").insert(rows);
        if (!error) result.wan += rows.length;
        else console.error("wan_logs insert error", error.message);
      }

      // 2.1 Speedtests executados localmente pelo agente a cada 30 minutos
      if (Array.isArray(p.speedtests) && p.speedtests.length > 0) {
        const rows = p.speedtests.map((test: any) => ({
          interface_name: String(test.interface_name || "Speedtest"),
          rx_bps: Math.max(0, Math.round(Number(test.rx_bps) || 0)),
          tx_bps: 0,
          rx_bytes:
            test.rx_bytes != null ? Math.max(0, Number(test.rx_bytes)) : null,
          tx_bytes: 0,
          cpu_load:
            resource.cpu_load != null ? Number(resource.cpu_load) : null,
          free_memory:
            resource.free_memory != null ? Number(resource.free_memory) : null,
          total_memory:
            resource.total_memory != null
              ? Number(resource.total_memory)
              : null,
          temperature:
            resource.temperature != null ? Number(resource.temperature) : null,
          created_at: loggedAt,
        }));
        const { error } = await supabase.from("wan_logs").insert(rows);
        if (!error) result.speedtests += rows.length;
        else console.error("speedtest wan_logs insert error", error.message);
      }

      // 3. PPPoE sessions per customer
      // Agentes anteriores não enviavam esse indicador; preserve compatibilidade.
      const pppoeCollectionOk = p.diagnostics?.pppoe_collection_ok !== false;
      if (p.online !== false && Array.isArray(p.pppoe)) {
        const snapshotNames = [
          ...new Set(
            p.pppoe
              .map((s: any) =>
                String(s.usuario_pppoe || "")
                  .trim()
                  .toLowerCase(),
              )
              .filter(Boolean),
          ),
        ];
        const { data: previousSnapshot } = pppoeCollectionOk
          ? await supabase
              .from("mikrotik_pppoe_snapshots")
              .select("usernames")
              .eq("host", String(p.host || "desconhecido"))
              .eq("collection_ok", true)
              .order("collected_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null };
        const { error: snapshotError } = await supabase
          .from("mikrotik_pppoe_snapshots")
          .insert({
            host: String(p.host || "desconhecido"),
            collected_at: loggedAt,
            collection_ok: pppoeCollectionOk,
            usernames: snapshotNames,
          });
        if (snapshotError)
          console.error(
            "mikrotik_pppoe_snapshots insert error",
            snapshotError.message,
          );

        if (pppoeCollectionOk && previousSnapshot) {
          const previousNames = new Set(
            (previousSnapshot.usernames || []).map((name: unknown) =>
              String(name).trim().toLowerCase(),
            ),
          );
          const currentNames = new Set(snapshotNames);
          const sessionsByName = new Map(
            p.pppoe.map((session: any) => [
              String(session.usuario_pppoe || "")
                .trim()
                .toLowerCase(),
              session,
            ]),
          );
          const sessionEvents: any[] = [];

          for (const username of currentNames) {
            if (previousNames.has(username)) continue;
            const customerId = customerMap.get(username);
            const session = sessionsByName.get(username);
            if (!customerId || !session) continue;
            sessionEvents.push({
              customer_id: customerId,
              usuario_pppoe: session.usuario_pppoe,
              event_type: "connected",
              ip_address: session.ip_address || null,
              uptime: session.uptime || null,
              logged_at: loggedAt,
            });
          }

          for (const username of previousNames) {
            if (currentNames.has(username)) continue;
            const customerId = customerMap.get(username);
            if (!customerId) continue;
            sessionEvents.push({
              customer_id: customerId,
              usuario_pppoe: username,
              event_type: "disconnected",
              ip_address: null,
              uptime: null,
              logged_at: loggedAt,
            });
          }

          if (sessionEvents.length > 0) {
            const { error: eventError } = await supabase
              .from("pppoe_logs")
              .insert(sessionEvents);
            if (eventError)
              console.error(
                "pppoe session events insert error",
                eventError.message,
              );
          }
        }
      }

      if (pppoeCollectionOk && Array.isArray(p.pppoe) && p.pppoe.length > 0) {
        const rows: any[] = [];
        for (const s of p.pppoe) {
          const name = String(s.usuario_pppoe || "").toLowerCase();
          const customerId = customerMap.get(name);
          if (!customerId) {
            if (name && !result.unknown_pppoe.includes(name))
              result.unknown_pppoe.push(name);
            continue;
          }
          rows.push({
            customer_id: customerId,
            usuario_pppoe: s.usuario_pppoe,
            event_type: s.event_type || "stats",
            ip_address: s.ip_address || null,
            uptime: s.uptime || null,
            rx_bytes: s.rx_bytes != null ? Number(s.rx_bytes) : null,
            tx_bytes: s.tx_bytes != null ? Number(s.tx_bytes) : null,
            logged_at: loggedAt,
          });
        }
        if (rows.length) {
          const { error } = await supabase.from("pppoe_logs").insert(rows);
          if (!error) result.pppoe += rows.length;
          else console.error("pppoe_logs insert error", error.message);
        }
      }
    }

    return json({ success: true, agent: agent.name, ...result });
  } catch (e) {
    console.error("mikrotik-agent-ingest error", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
