// Acesso à API REST do MikroTik (RouterOS 7) com as configurações da tabela settings.
// Tenta o host principal e o secundário; na vpsfaedi o host é host.docker.internal:18090 (repasse).
// deno-lint-ignore-file no-explicit-any

export type Mikrotik = {
  base: string;
  get: (path: string, timeoutMs?: number) => Promise<any>;
  post: (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
};

async function chamada(base: string, auth: string, path: string, method: string, body?: unknown, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/rest${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Connection: "close" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const txt = await r.text();
    let data: any = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) throw new Error(`MikroTik ${path}: HTTP ${r.status} ${typeof data === "object" ? data?.message || data?.detail || "" : ""}`.trim());
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function conectarMikrotik(supabase: any): Promise<Mikrotik> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["mikrotik_host", "mikrotik_host_secondary", "mikrotik_username", "mikrotik_password", "mikrotik_rest_port"]);
  const c: Record<string, string> = {};
  for (const r of data || []) c[r.key] = r.value ?? "";
  const hosts = [c.mikrotik_host, c.mikrotik_host_secondary].map((h) => (h || "").trim()).filter(Boolean);
  if (!hosts.length) throw new Error("MikroTik não configurado");
  const porta = c.mikrotik_rest_port || "80";
  const auth = btoa(`${c.mikrotik_username || "admin"}:${c.mikrotik_password || ""}`);
  const erros: string[] = [];
  for (const h of hosts) {
    const base = `${["443", "8443", "4443"].includes(porta) ? "https" : "http"}://${h}:${porta}`;
    try {
      await chamada(base, auth, "/system/identity", "GET", undefined, 4000);
      return {
        base,
        get: (p, ms) => chamada(base, auth, p, "GET", undefined, ms),
        post: (p, b, ms) => chamada(base, auth, p, "POST", b, ms),
      };
    } catch (e) {
      erros.push(`${h}: ${(e as Error).message}`);
    }
  }
  throw new Error(`MikroTik inacessível (${erros.join("; ")})`);
}

/** "1ms234us", "12ms", "345us", "1s5ms" → milissegundos */
export function duracaoMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v);
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const un: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1, us: 0.001 };
  let total = 0;
  let achou = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|us|h|m|s)/g)) {
    total += Number(m[1]) * un[m[2]];
    achou = true;
  }
  return achou ? total : null;
}

/** "100M", "100000000", "1.5G", "512k" → Mbps */
export function taxaMbps(v: unknown): number | null {
  if (v == null || v === "") return null;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*([kKmMgG])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const f: Record<string, number> = { k: 1e-3, m: 1, g: 1000 };
  return m[2] ? n * f[m[2].toLowerCase()] : n / 1e6;
}
