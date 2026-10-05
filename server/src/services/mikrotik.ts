import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "../db.js";
import { getSettings } from "./settings.js";

export async function mikrotikConfig() {
  const cfg = await getSettings([
    "mikrotik_host",
    "mikrotik_host_secondary",
    "mikrotik_username",
    "mikrotik_password",
    "mikrotik_api_port",
    "mikrotik_rest_port",
  ]);
  return {
    hosts: [cfg.mikrotik_host, cfg.mikrotik_host_secondary].filter(Boolean) as string[],
    username: cfg.mikrotik_username || "admin",
    password: cfg.mikrotik_password || "",
    apiPort: parseInt(cfg.mikrotik_api_port || "8728", 10) || 8728,
    restPort: cfg.mikrotik_rest_port || "80",
  };
}

export async function restCall(
  base: string,
  path: string,
  auth: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 8000
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/rest${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Connection: "close",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function findActiveHost(): Promise<{ base: string; auth: string; restPort: string } | null> {
  const cfg = await mikrotikConfig();
  if (!cfg.hosts.length) return null;
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  for (const host of cfg.hosts) {
    const base = `http://${host}:${cfg.restPort}`;
    const probe = await restCall(base, "/system/resource", auth, "GET", undefined, 4000);
    if (probe.ok) return { base, auth, restPort: cfg.restPort };
  }
  return null;
}

export async function getActiveBase(): Promise<{ base: string; auth: string } | null> {
  const active = await findActiveHost();
  return active ? { base: active.base, auth: active.auth } : null;
}

export async function queueMikrotikCommand(customerId: string | null, usuarioPppoe: string, action: string, payload: unknown) {
  await execute(
    "INSERT INTO mikrotik_commands (id, customer_id, usuario_pppoe, action, payload) VALUES (?, ?, ?, ?, ?)",
    [randomUUID(), customerId, usuarioPppoe, action, JSON.stringify(payload ?? {})]
  );
}

export async function syncCustomerToRouter(customerId: string) {
  const customer = await queryOne<Record<string, any>>(
    `SELECT c.*, p.nome AS plan_name FROM customers c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = ?`,
    [customerId]
  );
  if (!customer) throw new Error("Cliente não encontrado");
  if (!customer.usuario_pppoe) throw new Error("Cliente sem usuário PPPoE");

  const active = await findActiveHost();
  if (!active) {
    await queueMikrotikCommand(customer.id, customer.usuario_pppoe, "sync", {
      password: customer.senha_pppoe, nome: customer.nome,
    });
    return { queued: true };
  }

  const { base, auth } = active;
  const username = customer.usuario_pppoe;
  const planName = customer.plan_name || "default";
  const list = await restCall(base, `/ppp/secret?name=${encodeURIComponent(username)}`, auth);
  const existing = Array.isArray(list.data) ? list.data.find((s: any) => s.name === username) : null;

  if (planName !== "default") {
    const profiles = await restCall(base, `/ppp/profile?name=${encodeURIComponent(planName)}`, auth);
    const hasProfile = Array.isArray(profiles.data) ? profiles.data.some((p: any) => p.name === planName) : false;
    if (!hasProfile) {
      const speed = planName.match(/\d+/)?.[0] || "10";
      await restCall(base, "/ppp/profile", auth, "PUT", {
        name: planName, "local-address": "10.0.0.1", "rate-limit": `${speed}M/${speed}M`,
      });
    }
  }

  const disabled = customer.ativo === false || customer.block_status === "blocked";
  const secretData = {
    name: username,
    password: customer.senha_pppoe || "",
    service: "pppoe",
    profile: planName,
    disabled: disabled ? "true" : "false",
    comment: `${customer.nome} | Status: ${customer.block_status || "active"}`,
  };

  if (!existing) {
    await restCall(base, "/ppp/secret", auth, "PUT", secretData);
  } else {
    await restCall(base, `/ppp/secret/${existing[".id"]}`, auth, "PATCH", secretData);
  }

  if (disabled) {
    const activeSess = await restCall(base, `/ppp/active?name=${encodeURIComponent(username)}`, auth);
    const session = Array.isArray(activeSess.data) ? activeSess.data.find((a: any) => a.name === username) : null;
    if (session) await restCall(base, `/ppp/active/${session[".id"]}`, auth, "DELETE");
  }
  return { queued: false, username };
}

// ----------------------------------------------------------------- mikrotik-status
export async function mikrotikStatus() {
  const cfg = await mikrotikConfig();
  if (!cfg.hosts.length) return { online: false, message: "Configure o IP/Host do Mikrotik em Configurações" };

  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  let restOk = false;
  let restPort: number | null = null;
  let connectedHost = cfg.hosts[0];
  let identity: string | null = null;
  let version: string | null = null;
  let uptime: string | null = null;
  let cpuLoad: number | null = null;
  let freeMemory: number | null = null;
  let totalMemory: number | null = null;
  let temperature: number | null = null;
  let activeUsers: number | null = null;
  let activeList: any[] = [];
  let wans: any[] = [];

  const configured = parseInt(cfg.restPort, 10);
  const restPorts = [...new Set([configured, 80, 8080, 443, 8443, 81, 4443, 8081].filter(Boolean))] as number[];

  for (const host of cfg.hosts) {
    if (restOk) break;
    for (const p of restPorts) {
      const scheme = [443, 8443, 4443].includes(p) ? "https" : "http";
      const base = `${scheme}://${host}:${p}`;
      const res = await restCall(base, "/system/resource", auth, "GET", undefined, 3000);
      if (res.ok && res.data) {
        connectedHost = host;
        restOk = true;
        restPort = p;
        const r = res.data;
        uptime = r.uptime ?? null;
        version = r.version ?? null;
        cpuLoad = r["cpu-load"] !== undefined ? Number(r["cpu-load"]) : null;
        freeMemory = r["free-memory"] !== undefined ? Number(r["free-memory"]) : null;
        totalMemory = r["total-memory"] !== undefined ? Number(r["total-memory"]) : null;

        const [idty, active, resource, health] = await Promise.all([
          restCall(base, "/system/identity", auth, "GET", undefined, 4000),
          restCall(base, "/ppp/active", auth, "GET", undefined, 5000),
          restCall(base, "/interface", auth, "GET", undefined, 5000),
          restCall(base, "/system/health", auth, "GET", undefined, 4000),
        ]);
        identity = idty.data?.name ?? null;
        if (Array.isArray(health.data)) {
          const temp = health.data.find((h: any) => h.name === "temperature");
          if (temp) temperature = Number(temp.value);
        } else if (health.data?.temperature !== undefined) {
          temperature = Number(health.data.temperature);
        }

        const interfaces = Array.isArray(resource.data) ? resource.data : [];
        const wanNames = ["BrisanetPPoe", "pppoe-out1"];
        const wanInterfaces = interfaces.filter((i: any) => wanNames.includes(i.name));
        if (wanInterfaces.length > 0) {
          const now = Date.now();
          const rows = wanInterfaces.map((i: any) => {
            const rxBytes = parseInt(i["rx-byte"] ?? "0", 10) || 0;
            const txBytes = parseInt(i["tx-byte"] ?? "0", 10) || 0;
            return { interface_name: i.name, rx_bps: 0, tx_bps: 0, rx_bytes: rxBytes, tx_bytes: txBytes };
          });
          if (rows.length) {
            const values: unknown[] = [];
            const sql = `INSERT INTO wan_logs (id, interface_name, rx_bps, tx_bps, rx_bytes, tx_bytes, cpu_load, free_memory, total_memory, temperature, created_at) VALUES ${rows.map(() => "(?,?,?,?,?,?,?,?,?,?,NOW())").join(",")}`;
            for (const r of rows) values.push(randomUUID(), r.interface_name, r.rx_bps, r.tx_bps, r.rx_bytes, r.tx_bytes, cpuLoad, freeMemory, totalMemory, temperature);
            await execute(sql, values);
          }
          wans = rows.map((r, idx) => ({
            name: wanInterfaces[idx].name,
            type: wanInterfaces[idx].type,
            running: String(wanInterfaces[idx].running) === "true",
            disabled: String(wanInterfaces[idx].disabled) === "true",
            rx_bps: r.rx_bps,
            tx_bps: r.tx_bps,
          }));
        }

        if (Array.isArray(active.data)) {
          const list = active.data as Record<string, string>[];
          activeUsers = list.length;
          activeList = list.slice(0, 200).map((a) => {
            const iface = interfaces.find((i: any) => i.name === a.name || i.name === `<pppoe-${a.name}>`);
            return {
              name: a.name,
              address: a.address,
              uptime: a.uptime,
              rx_bytes: iface ? parseInt(iface["rx-byte"] || "0", 10) : 0,
              tx_bytes: iface ? parseInt(iface["tx-byte"] || "0", 10) : 0,
            };
          });
        }
        break;
      }
    }
  }

  const online = restOk;
  const source = restOk ? "direct" : "offline";
  const message = restOk
    ? `Conectado via API REST no host ${connectedHost} (porta ${restPort})`
    : "Não foi possível alcançar o Mikrotik";

  await execute(
    "INSERT INTO mikrotik_status_history (id, host, online, message) VALUES (?, ?, ?, ?)",
    [randomUUID(), connectedHost || cfg.hosts[0], online, message]
  );

  return {
    online, source, host: connectedHost, restApi: restOk, restPort,
    identity, version, uptime, cpuLoad, freeMemory, totalMemory, temperature,
    activeUsers, activeList, wans, message,
  };
}

export async function mikrotikSync() {
  const cfg = await mikrotikConfig();
  const active = await findActiveHost();
  const stats = { profiles: 0, secrets: 0, updated: 0, kicked: 0, alerts: 0, skipped: 0 };

  // Envia alertas pendentes de bloqueio (funciona mesmo sem acesso direto)
  const pendingAlerts = await query<Record<string, any>[]>(
    `SELECT ba.id, ba.customer_id, ba.new_status, c.nome, c.telefone
     FROM block_alerts_sent ba LEFT JOIN customers c ON c.id = ba.customer_id
     WHERE (ba.processed = false OR ba.processed IS NULL) LIMIT 30`
  );
  // os alertas são efetivamente enviados pelo worker mikrotik-alerts; nada aqui.

  if (!active) return { success: true, queuedOnly: true, ...stats };

  const { base, auth } = active;
  const probe = await restCall(base, "/system/resource", auth, "GET", undefined, 5000);
  if (!probe.ok) return { success: false, error: "API REST do Mikrotik não respondeu" };

  const [profilesRes, secretsRes] = await Promise.all([
    restCall(base, "/ppp/profile", auth),
    restCall(base, "/ppp/secret", auth, "GET", undefined, 15000),
  ]);

  const plans = await query<Record<string, any>[]>("SELECT * FROM plans");
  for (const plan of plans) {
    const speed = (plan.nome?.match(/\d+/) ?? ["10"])[0];
    const limit = `${speed}M/${speed}M`;
    const existing = (profilesRes.data ?? []).find((p: any) => p.name === plan.nome);
    if (!existing) {
      await restCall(base, "/ppp/profile", auth, "PUT", { name: plan.nome, "local-address": "10.0.0.1", "rate-limit": limit });
      stats.profiles++;
    }
  }

  const customers = await query<Record<string, any>[]>(
    `SELECT c.*, p.nome AS plan_name FROM customers c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.usuario_pppoe IS NOT NULL`
  );
  for (const customer of customers) {
    const planName = customer.plan_name || "default";
    const isBlocked = customer.block_status === "blocked" || !customer.ativo;
    const secretData = {
      name: customer.usuario_pppoe, password: customer.senha_pppoe, service: "pppoe",
      profile: planName, disabled: isBlocked ? "true" : "false",
      comment: `ID: ${customer.id} | Status: ${customer.block_status}`,
    };
    const existing = (secretsRes.data ?? []).find((s: any) => s.name === customer.usuario_pppoe);
    if (!existing) {
      await restCall(base, "/ppp/secret", auth, "PUT", secretData);
      stats.secrets++;
    } else {
      const currentDisabled = existing.disabled === "true";
      if (currentDisabled !== isBlocked || existing.profile !== planName) {
        await restCall(base, `/ppp/secret/${existing[".id"]}`, auth, "PATCH", secretData);
        stats.updated++;
      }
    }
  }
  return { success: true, ...stats };
}

export async function mikrotikSpeedtest() {
  const active = await findActiveHost();
  if (!active) return { error: "Nenhum host Mikrotik respondeu" };
  const { base, auth } = active;
  const interfaces = await restCall(base, "/interface", auth);
  const wanNames = ["BrisanetPPoe", "pppoe-out1"];
  const wanInterfaces = (interfaces.data ?? []).filter((i: any) => wanNames.includes(i.name));
  if (!wanInterfaces.length) return { error: "Nenhuma interface WAN encontrada" };

  const results: any[] = [];
  for (const wan of wanInterfaces) {
    const addresses = await restCall(base, `/ip/address?interface=${encodeURIComponent(wan.name)}`, auth);
    const rawIp = addresses.data?.[0]?.address || "0.0.0.0";
    const ip = rawIp.split("/")[0];
    if (ip === "0.0.0.0") {
      results.push({ interface_name: wan.name, rx_bytes: 0, tx_bytes: 0, mbps: 0, status: "Offline" });
      continue;
    }
    let mbps = 0;
    let rxBytes = 0;
    let status = "Error";
    try {
      const res = await restCall(base, "/tool/fetch", auth, "POST", {
        url: "http://ash-speed.hetzner.com/100MB.bin",
        "src-address": ip, duration: "3s", mode: "http", "as-value": true,
      }, 15000);
      if (res.ok) {
        const arr = Array.isArray(res.data) ? res.data : [res.data];
        const last = arr[arr.length - 1] || {};
        rxBytes = parseInt(last.downloaded || "0", 10);
        const m = (last.duration || "3s").match(/(\d+)s/);
        const dur = m ? Math.max(1, parseInt(m[1])) : 3;
        const rawMbps = (rxBytes * 8) / (dur * 1000 * 1000);
        mbps = rawMbps > 2000 ? 0 : Math.round(rawMbps * 100) / 100;
        status = mbps > 0 ? "Success" : "Success (No Traffic)";
      } else {
        status = "Fetch Failed";
      }
    } catch {
      status = "Exception";
    }
    results.push({ interface_name: wan.name, rx_bytes: rxBytes, tx_bytes: 0, mbps, status });
  }

  if (results.length) {
    const values: unknown[] = [];
    const sql = `INSERT INTO wan_logs (id, interface_name, rx_bps, rx_bytes, tx_bytes, created_at) VALUES ${results.map(() => "(?,?,?,?,?,NOW())").join(",")}`;
    for (const r of results) values.push(randomUUID(), r.interface_name, Math.round(r.mbps * 1000000), r.rx_bytes, r.tx_bytes);
    await execute(sql, values);
  }
  return { success: true, processed: results.length, results };
}
