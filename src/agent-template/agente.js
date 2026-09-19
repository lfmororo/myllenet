#!/usr/bin/env node
/**
 * Mororo.Tech - Agente de Monitoramento Mikrotik via SSH
 * Coleta métricas pelo túnel VPN e envia para o sistema.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) { console.error("Arquivo .env não encontrado em", file); process.exit(1); }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

const CFG = {
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  agentToken: process.env.AGENT_TOKEN || "",
  hosts: [process.env.MIKROTIK_HOST, process.env.MIKROTIK_HOST_SECONDARY].filter(Boolean),
  user: process.env.MIKROTIK_USER || "admin",
  pass: process.env.MIKROTIK_PASSWORD || "",
  sshPort: Number(process.env.MIKROTIK_SSH_PORT || 22),
  intervalSeconds: Math.max(5, parseInt(process.env.INTERVAL_SECONDS || "30", 10)),
  wanFilter: (process.env.WAN_INTERFACES || "").split(",").map((s) => s.trim()).filter(Boolean),
  collectPppoe: String(process.env.COLLECT_PPPOE || "true") === "true",
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || "8000", 10),
  queueFile: path.join(__dirname, "queue.json"),
  maxQueue: 500,
};
if (!CFG.supabaseUrl || !CFG.agentToken) { console.error("SUPABASE_URL e AGENT_TOKEN são obrigatórios no .env"); process.exit(1); }
if (CFG.hosts.length === 0) { console.error("Configure MIKROTIK_HOST no .env"); process.exit(1); }

const INGEST_URL = `${CFG.supabaseUrl}/functions/v1/mikrotik-agent-ingest`;
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const cleanHost = (host) => String(host).replace(/^https?:\/\//, "").split("/")[0].replace(/:\d+$/, "");

function parseValueRows(raw) {
  const clean = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim();
  const rows = [];
  let current = {};
  for (const line of clean.split("\n")) {
    const text = line.trim();
    if (!text) { if (Object.keys(current).length) { rows.push(current); current = {}; } continue; }
    const parts = text.split(";").filter(Boolean);
    let found = false;
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq < 1) continue;
      current[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      found = true;
    }
    if (found && parts.length > 1) { rows.push(current); current = {}; }
  }
  if (Object.keys(current).length) rows.push(current);
  return rows;
}

function sshExec(host, command) {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; conn.end(); resolve(result); };
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) return finish({ ok: false, status: 0, error: err.message });
        let stdout = ""; let stderr = "";
        stream.on("data", (d) => { stdout += d.toString(); });
        stream.stderr.on("data", (d) => { stderr += d.toString(); });
        stream.on("close", (code) => finish(code === 0
          ? { ok: true, data: parseValueRows(stdout) }
          : { ok: false, status: code || 0, error: stderr.trim() || `SSH saiu com código ${code}` }));
      });
    }).on("error", (e) => finish({ ok: false, status: 0, error: e.message }))
      .connect({ host: cleanHost(host), port: CFG.sshPort, username: CFG.user, password: CFG.pass, readyTimeout: CFG.requestTimeoutMs, keepaliveInterval: 3000 });
  });
}

async function pickHost() {
  for (const host of CFG.hosts) {
    const start = Date.now();
    const probe = await sshExec(host, "/system resource print as-value");
    const duration = Date.now() - start;
    if (probe.ok && probe.data.length) return { host, resource: probe.data, duration };
    const error = probe.error || "Resposta SSH vazia";
    log(`Host ${host} indisponível via SSH: ${error} (${duration}ms)`);
    await flush({ host, online: false, collected_at: new Date().toISOString(), message: `Agente VPS SSH: erro ao conectar em ${host}: ${error}`, diagnostics: { duration, error, status: probe.status, protocol: "ssh" } });
  }
  return null;
}

const prevCounters = new Map();
function isWan(name, comment) {
  if (CFG.wanFilter.length > 0) return CFG.wanFilter.some((f) => name.toLowerCase().includes(f.toLowerCase()));
  const n = name.toLowerCase();
  return n.includes("wan") || n.includes("pppoe-out") || n.includes("ether1") || (comment || "").toLowerCase().includes("wan");
}

async function collect(host, resourceRaw) {
  const now = Date.now();
  const resource = Array.isArray(resourceRaw) ? resourceRaw[0] || {} : resourceRaw || {};
  const [healthRes, ifaceRes, activeRes] = await Promise.all([
    sshExec(host, "/system health print as-value"),
    sshExec(host, "/interface print stats as-value"),
    CFG.collectPppoe ? sshExec(host, "/ppp active print stats as-value") : Promise.resolve({ ok: true, data: [] }),
  ]);
  let temperature = null;
  if (healthRes.ok) {
    const item = healthRes.data.find((h) => /temp/i.test(h.name || "")) || healthRes.data.find((h) => h.temperature != null);
    if (item) temperature = Number.parseFloat(item.value ?? item.temperature);
  }
  const wan = [];
  if (ifaceRes.ok) for (const item of ifaceRes.data) {
    const name = item.name;
    if (!name || !isWan(name, item.comment) || item.running === "false" || item.disabled === "true") continue;
    const rx = Number(item["rx-byte"] || 0); const tx = Number(item["tx-byte"] || 0);
    const prev = prevCounters.get(name); prevCounters.set(name, { rx, tx, ts: now });
    let rxBps = 0; let txBps = 0;
    if (prev) {
      const seconds = (now - prev.ts) / 1000;
      if (seconds > 0 && seconds < CFG.intervalSeconds * 5 && rx >= prev.rx && tx >= prev.tx) {
        rxBps = ((rx - prev.rx) * 8) / seconds; txBps = ((tx - prev.tx) * 8) / seconds;
      }
    }
    if (rxBps > 2_000_000_000) rxBps = 0;
    if (txBps > 2_000_000_000) txBps = 0;
    wan.push({ interface_name: name, rx_bps: rxBps, tx_bps: txBps, rx_bytes: rx, tx_bytes: tx });
  }
  const pppoe = [];
  if (activeRes.ok) for (const s of activeRes.data) pppoe.push({ usuario_pppoe: s.name, ip_address: s.address || null, uptime: s.uptime || null, rx_bytes: s["bytes-in"] != null ? Number(s["bytes-in"]) : null, tx_bytes: s["bytes-out"] != null ? Number(s["bytes-out"]) : null, event_type: "stats" });
  return {
    host, online: true, collected_at: new Date().toISOString(),
    message: `Agente VPS SSH: OK (${wan.length} WAN, ${pppoe.length} sessões PPPoE)`,
    diagnostics: { duration: resourceRaw.duration, protocol: "ssh", port: CFG.sshPort },
    resource: { cpu_load: resource["cpu-load"] != null ? Number(resource["cpu-load"]) : null, free_memory: resource["free-memory"] != null ? Number(resource["free-memory"]) : null, total_memory: resource["total-memory"] != null ? Number(resource["total-memory"]) : null, temperature, uptime: resource.uptime || null, version: resource.version || null },
    wan, pppoe,
  };
}

function readQueue() { try { return JSON.parse(fs.readFileSync(CFG.queueFile, "utf8")); } catch { return []; } }
function writeQueue(items) { try { fs.writeFileSync(CFG.queueFile, JSON.stringify(items.slice(-CFG.maxQueue))); } catch (e) { log("Falha ao gravar fila local:", e.message); } }
async function send(payloads) {
  const res = await fetch(INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": CFG.agentToken }, body: JSON.stringify(payloads.length === 1 ? payloads[0] : { batch: payloads }) });
  const text = await res.text(); if (!res.ok) throw new Error(`Ingest HTTP ${res.status}: ${text.slice(0, 200)}`); return text;
}
async function flush(payload) {
  const queue = readQueue(); const batch = [...queue, payload];
  try { const out = await send(batch); if (queue.length) writeQueue([]); log(`Enviado (${batch.length} amostra(s)) →`, out.slice(0, 200)); }
  catch (e) { log("Envio falhou, guardando na fila local:", e.message); writeQueue(batch); }
}
let running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const picked = await pickHost();
    if (!picked) { await flush({ host: CFG.hosts[0], online: false, collected_at: new Date().toISOString(), message: "Agente VPS SSH: nenhum host Mikrotik respondeu" }); return; }
    const payload = await collect(picked.host, picked.resource); payload.diagnostics.duration = picked.duration; await flush(payload);
  } catch (e) { log("Erro no ciclo:", e.message); } finally { running = false; }
}
log(`Agente SSH iniciado. Hosts: ${CFG.hosts.join(", ")} | porta: ${CFG.sshPort} | intervalo: ${CFG.intervalSeconds}s`);
tick(); setInterval(tick, CFG.intervalSeconds * 1000);
process.on("SIGTERM", () => { log("Encerrando agente..."); process.exit(0); });
