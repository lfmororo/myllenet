import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { exigir } from "../_shared/auth.ts";
const AGENT_FALLBACK = Deno.env.get("MIKROTIK_AGENT") === "on"; // vpsfaedi: só API REST

async function tcpCheck(host: string, port: number, timeoutMs = 4000) {
  let conn: Deno.Conn | null = null;
  try {
    conn = await Promise.race([
      Deno.connect({ hostname: host, port }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs),
      ),
    ]);
    return true;
  } catch (_e) {
    return false;
  } finally {
    try {
      conn?.close();
    } catch (_e) {
      /* ignore */
    }
  }
}

async function restCall(
  base: string,
  path: string,
  auth: string,
  timeoutMs = 8000,
) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/rest${path}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Connection: "close",
        Accept: "application/json",
      },
      signal: ac.signal,
    });

    if (res.status === 401) return { ok: false, status: 401, data: null };
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`REST Error [${res.status}] at ${path}: ${text}`);
      return { ok: false, status: res.status, data: null };
    }

    const data = await res.json().catch((err) => {
      console.error(`JSON Parse Error at ${path}:`, err);
      return null;
    });

    return { ok: true, status: res.status, data };
  } catch (e) {
    const isAbort = (e as Error).name === "AbortError";
    if (!isAbort)
      console.error(`Fetch Error at ${path}:`, (e as Error).message);
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  const negado = await exigir(req, "usuario");
  if (negado) return negado;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rows } = await supabase
      .from("settings")
      .select("key,value")
      .in("key", [
        "mikrotik_host",
        "mikrotik_host_secondary",
        "mikrotik_username",
        "mikrotik_password",
        "mikrotik_api_port",
        "mikrotik_rest_port",
      ]);

    const cfg: Record<string, string> = {};
    for (const r of rows ?? []) cfg[r.key] = r.value ?? "";

    const hostPrimary = (cfg.mikrotik_host || "").trim();
    const hostSecondary = (cfg.mikrotik_host_secondary || "").trim();

    if (!hostPrimary && !hostSecondary) {
      return json({
        online: false,
        message: "Configure o IP/Host do Mikrotik em Configurações",
      });
    }

    const hosts = [hostPrimary, hostSecondary].filter(Boolean);
    const apiPort = parseInt(cfg.mikrotik_api_port || "8728", 10) || 8728;
    const user = cfg.mikrotik_username || "admin";
    const pass = cfg.mikrotik_password || "";
    const auth = btoa(`${user}:${pass}`);

    const configured = parseInt(cfg.mikrotik_rest_port || "", 10);
    const restPorts = [
      ...new Set(
        [configured, 80, 8080, 443, 8443, 81, 4443, 8081].filter(Boolean),
      ),
    ] as number[];
    const schemeFor = (p: number): "http" | "https" =>
      p === 443 || p === 8443 || p === 4443 ? "https" : "http";

    let identity: string | null = null;
    let uptime: string | null = null;
    let version: string | null = null;
    let cpuLoad: number | null = null;
    let freeMemory: number | null = null;
    let totalMemory: number | null = null;
    let temperature: number | null = null;
    let activeUsers: number | null = null;
    let activeList: any[] = [];
    let pppoeOk = false; // coleta completa de /ppp/active (usada pelo mikrotik-sync-logs)
    let wans: any[] = [];
    let restOk = false;
    let restPort: number | null = null;
    let lastStatus = 0;
    let authFailed = false;
    let reachable = false;
    let connectedHost = hostPrimary;
    let apiOpen = false;
    let p80 = false;
    let p443 = false;
    let openPorts: number[] = [];

    for (const host of hosts) {
      if (restOk) break;

      const probePorts = [...new Set([apiPort, ...restPorts])];
      const probes = await Promise.all(
        probePorts.map((p) => tcpCheck(host, p, 1500)),
      );
      const openMap = new Map<number, boolean>();
      probePorts.forEach((p, i) => openMap.set(p, probes[i]));

      const currentOpenPorts = probePorts.filter((p) => openMap.get(p));

      if (currentOpenPorts.length === 0 && host !== hosts[0]) continue;

      if (openMap.get(apiPort)) apiOpen = true;
      if (openMap.get(80)) p80 = true;
      if (openMap.get(443)) p443 = true;

      openPorts = [...new Set([...openPorts, ...currentOpenPorts])];
      if (currentOpenPorts.length > 0) reachable = true;

      const openRest = restPorts.filter((p) => openMap.get(p));
      if (openRest.length) {
        const attempts = [];
        for (const p of openRest) {
          const base = `${schemeFor(p)}://${host}:${p}`;
          const res = await restCall(base, "/system/resource", auth, 3000);
          if (res.ok || res.status === 401) {
            attempts.push({ port: p, base, res });
            if (res.ok) break;
          }
        }

        for (const a of attempts) {
          if (a.res.status) lastStatus = a.res.status;
          if (a.res.status === 401) authFailed = true;
        }

        const winner = attempts.find((a) => a.res.ok && a.res.data);
        if (winner) {
          connectedHost = host;
          const r = winner.res.data as Record<string, any>;
          restOk = true;
          restPort = winner.port;
          uptime = r.uptime ?? null;
          version = r.version ?? null;
          cpuLoad = r["cpu-load"] !== undefined ? Number(r["cpu-load"]) : null;
          freeMemory =
            r["free-memory"] !== undefined ? Number(r["free-memory"]) : null;
          totalMemory =
            r["total-memory"] !== undefined ? Number(r["total-memory"]) : null;

          const [idty, active, resource, health, updates] = await Promise.all([
            restCall(winner.base, "/system/identity", auth, 4000),
            restCall(winner.base, "/ppp/active", auth, 5000),
            restCall(winner.base, "/interface", auth, 5000),
            restCall(winner.base, "/system/health", auth, 4000),
            restCall(winner.base, "/system/package/update", auth, 4000),
          ]);
          identity = (idty.data as Record<string, string> | null)?.name ?? null;

          if (Array.isArray(health.data)) {
            const temp = (health.data as any[]).find(
              (h) => h.name === "temperature",
            );
            if (temp) temperature = Number(temp.value);
          } else if (
            health.data &&
            (health.data as any).temperature !== undefined
          ) {
            temperature = Number((health.data as any).temperature);
          }

          const interfaces = Array.isArray(resource.data)
            ? (resource.data as any[])
            : [];
          const isWanName = (i: any) =>
            /wan|uplink|internet|link/i.test(
              `${i.name ?? ""} ${i.comment ?? ""}`,
            );
          const uplinkTypes = [
            "ether",
            "vlan",
            "pppoe-out",
            "lte",
            "wireless",
            "wlan",
          ];
          const candidates = interfaces.filter((i) =>
            uplinkTypes.includes(String(i.type ?? "").toLowerCase()),
          );
          const wanNames = ["BrisanetPPoe", "pppoe-out1"];
          let wanInterfaces = candidates.filter(
            (i) => wanNames.includes(i.name) || isWanName(i),
          );

          if (wanInterfaces.length === 0) {
            const pppoeOut = candidates.filter(
              (i) => String(i.type).toLowerCase() === "pppoe-out",
            );
            wanInterfaces = (
              pppoeOut.length
                ? pppoeOut
                : candidates.filter(
                    (i) => String(i.type).toLowerCase() === "ether",
                  )
            ).slice(0, 4);
          }

          if (wanInterfaces.length > 0) {
            try {
              const { data: prevLogs } = await supabase
                .from("wan_logs")
                .select("interface_name, rx_bytes, tx_bytes, created_at")
                .in(
                  "interface_name",
                  wanInterfaces.map((i) => i.name),
                )
                .order("created_at", { ascending: false })
                .limit(wanInterfaces.length * 10);

              const now = Date.now();
              const MAX_AGE_SECS = 300;
              const rows = wanInterfaces.map((i) => {
                const rxBytes = parseInt(i["rx-byte"] ?? "0", 10) || 0;
                const txBytes = parseInt(i["tx-byte"] ?? "0", 10) || 0;
                const prev = (prevLogs ?? []).find((p: any) => {
                  if (p.interface_name !== i.name) return false;
                  const ageSecs =
                    (now - new Date(p.created_at).getTime()) / 1000;
                  if (ageSecs > MAX_AGE_SECS) return false;
                  const pRx = Number(p.rx_bytes ?? 0);
                  const pTx = Number(p.tx_bytes ?? 0);
                  if (rxBytes > 0 && pRx < rxBytes * 0.5) return false;
                  if (txBytes > 0 && pTx < txBytes * 0.5) return false;
                  return true;
                });
                let rxBps = 0;
                let txBps = 0;
                if (prev) {
                  const secs = Math.max(
                    1,
                    (now - new Date(prev.created_at).getTime()) / 1000,
                  );
                  const dRx = rxBytes - Number(prev.rx_bytes ?? 0);
                  const dTx = txBytes - Number(prev.tx_bytes ?? 0);
                  if (dRx >= 0) rxBps = Math.round((dRx * 8) / secs);
                  if (dTx >= 0) txBps = Math.round((dTx * 8) / secs);
                  if (rxBps > 2000_000_000) rxBps = 0;
                  if (txBps > 2000_000_000) txBps = 0;
                }
                return {
                  interface_name: i.name,
                  rx_bps: rxBps,
                  tx_bps: txBps,
                  rx_bytes: rxBytes,
                  tx_bytes: txBytes,
                };
              });

              if (rows.length > 0) {
                await supabase.from("wan_logs").insert(
                  rows.map((r) => ({
                    interface_name: r.interface_name,
                    rx_bps: r.rx_bps,
                    tx_bps: r.tx_bps,
                    rx_bytes: r.rx_bytes,
                    tx_bytes: r.tx_bytes,
                    cpu_load: cpuLoad,
                    free_memory: freeMemory,
                    total_memory: totalMemory,
                    temperature: temperature,
                    created_at: new Date().toISOString(),
                  })),
                );
              }

              wans = wanInterfaces.map((i) => {
                const row = rows.find((r) => r.interface_name === i.name);
                return {
                  name: i.name,
                  type: i.type,
                  running:
                    String(i.running) === "true" &&
                    String(i.disabled) !== "true",
                  disabled: String(i.disabled) === "true",
                  rx_bps: row?.rx_bps ?? 0,
                  tx_bps: row?.tx_bps ?? 0,
                };
              });

              for (const wan of wanInterfaces) {
                const isUp =
                  String(wan.running) === "true" &&
                  String(wan.disabled) !== "true";
                const { data: lastEvents } = await supabase
                  .from("wan_status_history")
                  .select("status")
                  .eq("interface_name", wan.name)
                  .order("created_at", { ascending: false })
                  .limit(1);

                const previous = lastEvents?.[0]?.status ?? null;
                const currentStatus = isUp ? "up" : "down";
                if (previous !== currentStatus) {
                  await supabase.from("wan_status_history").insert({
                    interface_name: wan.name,
                    status: currentStatus,
                    reason: isUp
                      ? "Interface running e trafegando dados"
                      : String(wan.disabled) === "true"
                        ? "Interface desabilitada no roteador"
                        : "Link caiu (running=false)",
                  });
                }
              }
            } catch (e) {
              console.error("Error logging WAN status:", e);
            }
          }

          if (Array.isArray(active.data)) {
            const list = active.data as Record<string, string>[];
            activeUsers = list.length;
            pppoeOk = true;
            activeList = list.map((a) => {
              const iface = interfaces.find(
                (i) =>
                  i.name === a.name ||
                  i.name === `<pppoe-${a.name}>` ||
                  (i.type === "pppoe-in" && i.name.includes(a.name)),
              );
              return {
                name: a.name,
                address: a.address,
                uptime: a.uptime,
                rx_bytes: iface ? parseInt(iface["rx-byte"] || "0", 10) : 0,
                tx_bytes: iface ? parseInt(iface["tx-byte"] || "0", 10) : 0,
              };
            });
          }

          let updateAvailable = false;
          let latestVersion = null;
          if (updates.ok && updates.data) {
            const u = updates.data as Record<string, any>;
            if (
              u.status === "New version is available" ||
              (u["latest-version"] && u["latest-version"] !== version)
            ) {
              updateAvailable = true;
              latestVersion = u["latest-version"];
            }
          }
        }
      }
    }

    let online = restOk || reachable;
    let source: "direct" | "agent" | "offline" = online ? "direct" : "offline";

    if (!restOk && AGENT_FALLBACK) {
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: agentStatus } = await supabase
        .from("mikrotik_status_history")
        .select("host, online, logged_at, diagnostics")
        .eq("online", true)
        .like("message", "Agente VPS:%")
        .gt("logged_at", twoMinAgo)
        .order("logged_at", { ascending: false })
        .limit(1);

      if (agentStatus && agentStatus.length > 0) {
        online = true;
        source = "agent";
        connectedHost = agentStatus[0].host || connectedHost;
        const { data: latestMetrics } = await supabase
          .from("wan_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestMetrics && latestMetrics.length > 0) {
          const m = latestMetrics[0];
          cpuLoad = m.cpu_load;
          freeMemory = m.free_memory;
          totalMemory = m.total_memory;
          temperature = m.temperature;
        }

        const { data: latestSnapshot } = await supabase
          .from("mikrotik_pppoe_snapshots")
          .select("usernames, collected_at, collection_ok")
          .eq("collection_ok", true)
          .gt("collected_at", twoMinAgo)
          .order("collected_at", { ascending: false })
          .limit(1);

        const names = Array.isArray(latestSnapshot?.[0]?.usernames)
          ? latestSnapshot[0].usernames.map((name: unknown) =>
              String(name).toLowerCase(),
            )
          : [];
        const { data: recentPppoeStats } = await supabase
          .from("pppoe_logs")
          .select(
            "usuario_pppoe, ip_address, uptime, rx_bytes, tx_bytes, logged_at",
          )
          .in("usuario_pppoe", names)
          .gt("logged_at", twoMinAgo)
          .order("logged_at", { ascending: false })
          .limit(Math.max(200, names.length * 5));
        const latestStatsByName = new Map<string, any>();
        for (const stat of recentPppoeStats || []) {
          const normalizedName = String(stat.usuario_pppoe || "").toLowerCase();
          if (!latestStatsByName.has(normalizedName)) {
            latestStatsByName.set(normalizedName, stat);
          }
        }
        activeList = names.map((name: string) => {
          const stat = latestStatsByName.get(name);
          return {
            name,
            address: stat?.ip_address || null,
            uptime: stat?.uptime || null,
            rx_bytes: stat?.rx_bytes ?? null,
            tx_bytes: stat?.tx_bytes ?? null,
          };
        });
        activeUsers = activeList.length;
      } else if (!reachable) {
        online = false;
        source = "offline";
      }
    }

    let message: string;
    if (source === "direct") {
      if (restOk)
        message = `Conectado via API REST no host ${connectedHost} (porta ${restPort})`;
      else if (authFailed)
        message =
          "API REST respondeu, mas usuário/senha foram rejeitados (401)";
      else message = "Conectado (apenas Ping/TCP), API REST não respondeu";
    } else if (source === "agent") {
      message = "Conectado via Agente VPS (Conexão direta indisponível)";
    } else {
      message = AGENT_FALLBACK
        ? "Não foi possível alcançar o Mikrotik (Direto ou Agente)"
        : "Não foi possível alcançar o Mikrotik pela API REST";
    }

    const responseData = {
      online,
      source,
      host: connectedHost,
      restApi: restOk,
      restPort,
      lastHttpStatus: lastStatus,
      ports: { api: apiOpen, http: p80, https: p443 },
      openPorts,
      identity,
      version,
      uptime,
      cpuLoad,
      freeMemory,
      totalMemory,
      temperature,
      activeUsers,
      activeList,
      pppoeOk,
      wans,
      // updateAvailable, // Not used in this response type context
      // latestVersion,  // Not used in this response type context
      message,
    };

    try {
      await supabase.from("mikrotik_status_history").insert({
        host: connectedHost || hostPrimary,
        online,
        message,
      });
    } catch (e) {
      console.error("Error logging status history:", e);
    }

    return json(responseData);
  } catch (e) {
    return json({ online: false, message: (e as Error).message }, 200);
  }
});
