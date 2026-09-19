#!/usr/bin/env node
/**
 * Mororo.Tech - Agente de Monitoramento Mikrotik
 * Coleta métricas do Mikrotik (RouterOS REST API) e envia para o sistema.
 * Requer Node.js 18+ (fetch nativo). Sem dependências externas.
 */

const fs = require("fs");
const path = require("path");
const net = require("net");

// ---------- .env loader (sem dependências) ----------
function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) {
    console.error("Arquivo .env não encontrado em", file);
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const CFG = {
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  agentToken: process.env.AGENT_TOKEN || "",
  hosts: [
    process.env.MIKROTIK_HOST,
    process.env.MIKROTIK_HOST_SECONDARY,
  ].filter(Boolean),
  user: process.env.MIKROTIK_USER || "admin",
  pass: process.env.MIKROTIK_PASSWORD || "",
  restPort: process.env.MIKROTIK_REST_PORT || "80",
  useHttps: String(process.env.MIKROTIK_USE_HTTPS || "false") === "true",
  intervalSeconds: Math.max(
    5,
    parseInt(process.env.INTERVAL_SECONDS || "30", 10),
  ),
  wanFilter: (process.env.WAN_INTERFACES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  collectPppoe: String(process.env.COLLECT_PPPOE || "true") === "true",
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || "8000", 10),
  queueFile: path.join(__dirname, "queue.json"),
  maxQueue: 500,
};

if (!CFG.supabaseUrl || !CFG.agentToken) {
  console.error("SUPABASE_URL e AGENT_TOKEN são obrigatórios no .env");
  process.exit(1);
}
if (CFG.hosts.length === 0) {
  console.error("Configure MIKROTIK_HOST no .env");
  process.exit(1);
}

const INGEST_URL = `${CFG.supabaseUrl}/functions/v1/mikrotik-agent-ingest`;
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

// ---------- Mikrotik REST ----------
const authHeader =
  "Basic " + Buffer.from(`${CFG.user}:${CFG.pass}`).toString("base64");

async function rest(host, endpoint) {
  const scheme = CFG.useHttps ? "https" : "http";
  const url = `${scheme}://${host}:${CFG.restPort}/rest${endpoint}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CFG.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        Connection: "close",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${body.slice(0, 100)}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    let err = e.message;
    if (e.name === "AbortError") err = `Timeout (${CFG.requestTimeoutMs}ms)`;
    return { ok: false, status: 0, error: err };
  } finally {
    clearTimeout(timer);
  }
}

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("timeout"));
    socket.once("error", (error) =>
      finish(error.code === "ECONNREFUSED" ? "refused" : "unreachable"),
    );
  });
}

/** Retorna o primeiro host que responde (preferencial primeiro). */
async function pickHost() {
  for (const host of CFG.hosts) {
    const start = Date.now();
    const probe = await rest(host, "/system/resource");
    const duration = Date.now() - start;
    if (probe.ok) return { host, resource: probe.data, duration };
    let diagnostic = probe.error;
    if (probe.status === 0) {
      const [restPortState, winboxState] = await Promise.all([
        tcpProbe(host, CFG.restPort),
        tcpProbe(host, 8291),
      ]);
      if (winboxState === "open" && restPortState !== "open") {
        diagnostic = `${probe.error}. Winbox 8291 responde, mas REST ${CFG.restPort} não responde; habilite/libere o serviço ${CFG.useHttps ? "www-ssl" : "www"}`;
      } else if (restPortState === "refused") {
        diagnostic = `${probe.error}. A porta REST ${CFG.restPort} recusou a conexão; confira o serviço ${CFG.useHttps ? "www-ssl" : "www"}`;
      }
    }
    log(`Host ${host} indisponível: ${diagnostic} (${duration}ms)`);
    // Se falhar, enviamos o erro individual para o histórico
    await flush({
      host,
      online: false,
      collected_at: new Date().toISOString(),
      message: `Agente VPS: erro ao conectar em ${host}: ${diagnostic}`,
      diagnostics: { duration, error: diagnostic, status: probe.status },
    });
  }
  return null;
}

// ---------- Coleta ----------
const prevCounters = new Map(); // interface -> { rx, tx, ts }

function isWan(name, comment) {
  if (CFG.wanFilter.length > 0)
    return CFG.wanFilter.some((f) =>
      name.toLowerCase().includes(f.toLowerCase()),
    );
  const n = name.toLowerCase();
  return (
    n.includes("wan") ||
    n.includes("pppoe-out") ||
    n.includes("ether1") ||
    (comment || "").toLowerCase().includes("wan")
  );
}

async function collect(host, resourceRaw, connectionDuration) {
  const now = Date.now();
  const resource = Array.isArray(resourceRaw)
    ? resourceRaw[0]
    : resourceRaw || {};

  const [healthRes, ifaceRes, activeRes] = await Promise.all([
    rest(host, "/system/health"),
    rest(host, "/interface"),
    CFG.collectPppoe
      ? rest(host, "/ppp/active")
      : Promise.resolve({ ok: true, data: [] }),
  ]);

  // Temperatura (formato varia entre versões do RouterOS)
  let temperature = null;
  if (healthRes.ok && Array.isArray(healthRes.data)) {
    const t = healthRes.data.find((h) => /temp/i.test(h.name || ""));
    if (t) temperature = parseFloat(t.value);
    else if (healthRes.data[0]?.temperature)
      temperature = parseFloat(healthRes.data[0].temperature);
  }

  // WAN: bps calculado pela diferença de contadores
  const wan = [];
  if (ifaceRes.ok && Array.isArray(ifaceRes.data)) {
    for (const i of ifaceRes.data) {
      const name = i.name;
      if (!name || !isWan(name, i.comment)) continue;
      if (i.running === "false" || i.disabled === "true") continue;

      const rx = Number(i["rx-byte"] || 0);
      const tx = Number(i["tx-byte"] || 0);
      const prev = prevCounters.get(name);
      prevCounters.set(name, { rx, tx, ts: now });

      let rxBps = 0;
      let txBps = 0;
      if (prev) {
        const seconds = (now - prev.ts) / 1000;
        if (
          seconds > 0 &&
          seconds < CFG.intervalSeconds * 5 &&
          rx >= prev.rx &&
          tx >= prev.tx
        ) {
          rxBps = ((rx - prev.rx) * 8) / seconds;
          txBps = ((tx - prev.tx) * 8) / seconds;
        }
      }
      // Sanidade: descarta picos irreais acima de 2 Gbps
      const LIMIT = 2_000_000_000;
      if (rxBps > LIMIT) rxBps = 0;
      if (txBps > LIMIT) txBps = 0;

      wan.push({
        interface_name: name,
        rx_bps: rxBps,
        tx_bps: txBps,
        rx_bytes: rx,
        tx_bytes: tx,
      });
    }
  }

  const pppoe = [];
  if (activeRes.ok && Array.isArray(activeRes.data)) {
    for (const s of activeRes.data) {
      pppoe.push({
        usuario_pppoe: s.name,
        ip_address: s.address || null,
        uptime: s.uptime || null,
        rx_bytes: s["bytes-in"] != null ? Number(s["bytes-in"]) : null,
        tx_bytes: s["bytes-out"] != null ? Number(s["bytes-out"]) : null,
        event_type: "stats",
      });
    }
  }

  const totalMemory =
    resource["total-memory"] != null ? Number(resource["total-memory"]) : null;
  const freeMemory =
    resource["free-memory"] != null ? Number(resource["free-memory"]) : null;

  return {
    host,
    online: true,
    collected_at: new Date().toISOString(),
    message: `Agente VPS: OK (${wan.length} WAN, ${pppoe.length} sessões PPPoE)`,
    diagnostics: {
      duration: connectionDuration,
      pppoe_collection_ok: activeRes.ok,
      pppoe_error: activeRes.ok
        ? null
        : activeRes.error || `HTTP ${activeRes.status || 0}`,
      pppoe_count: pppoe.length,
    },
    resource: {
      cpu_load:
        resource["cpu-load"] != null ? Number(resource["cpu-load"]) : null,
      free_memory: freeMemory,
      total_memory: totalMemory,
      temperature,
      uptime: resource.uptime || null,
      version: resource.version || null,
    },
    wan,
    pppoe,
  };
}

// ---------- Fila local (resiliência) ----------
function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(CFG.queueFile, "utf8"));
  } catch {
    return [];
  }
}
function writeQueue(items) {
  try {
    fs.writeFileSync(CFG.queueFile, JSON.stringify(items.slice(-CFG.maxQueue)));
  } catch (e) {
    log("Falha ao gravar fila local:", e.message);
  }
}

async function send(payloads) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-token": CFG.agentToken,
    },
    body: JSON.stringify(
      payloads.length === 1 ? payloads[0] : { batch: payloads },
    ),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`Ingest HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function flush(payload) {
  const queue = readQueue();
  const batch = [...queue, payload];
  try {
    const out = await send(batch);
    if (queue.length) writeQueue([]);
    log(`Enviado (${batch.length} amostra(s)) →`, out.slice(0, 200));
  } catch (e) {
    log("Envio falhou, guardando na fila local:", e.message);
    writeQueue(batch);
  }
}

// ---------- Loop ----------
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const picked = await pickHost();
    if (!picked) {
      await flush({
        host: CFG.hosts[0],
        online: false,
        collected_at: new Date().toISOString(),
        message: "Agente VPS: nenhum host Mikrotik respondeu",
      });
      return;
    }
    const payload = await collect(
      picked.host,
      picked.resource,
      picked.duration,
    );
    await flush(payload);
  } catch (e) {
    log("Erro no ciclo:", e.message);
  } finally {
    running = false;
  }
}

log(
  `Agente iniciado. Hosts: ${CFG.hosts.join(", ")} | intervalo: ${CFG.intervalSeconds}s`,
);
tick();
setInterval(tick, CFG.intervalSeconds * 1000);

process.on("SIGTERM", () => {
  log("Encerrando agente...");
  process.exit(0);
});
