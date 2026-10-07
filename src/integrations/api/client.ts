// Cliente unificado: alterna entre Supabase (padrão) e backend Fastify + PostgreSQL.
// Flag: VITE_BACKEND=supabase (padrão) | postgres
import { supabaseApi, supabaseAuthToken, SUPABASE_URL } from "@/integrations/api/supabaseAdapter";
import type { AuthUser } from "@/integrations/types";

export type { AuthUser };

const BACKEND = (import.meta.env.VITE_BACKEND as string) || "supabase";

const POSTGRES_API_URL =
  (import.meta.env.VITE_API_URL as string) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3333`
    : "http://localhost:3333");

const TOKEN_KEY = "myllenet_token";

let currentToken: string | null = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
let currentUser: AuthUser | null = null;

function setToken(token: string | null) {
  currentToken = token;
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function postgresAuthToken() {
  return currentToken;
}

interface HttpResponse {
  data: any;
  error: Error | null;
}

async function http(method: string, path: string, body?: unknown): Promise<HttpResponse> {
  try {
    const res = await fetch(`${POSTGRES_API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      return { data: null, error: new Error(data?.error || `HTTP ${res.status}`) };
    }
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e };
  }
}

// ---------------------------------------------------------------- filtros
type Filter =
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; column: string; value: unknown }
  | { op: "in"; column: string; values: unknown[] }
  | { op: "is"; column: string; value: unknown }
  | { op: "not"; column: string; subop: "eq" | "is" | "in"; value: unknown }
  | { op: "like" | "ilike"; column: string; value: string }
  | { op: "or"; filters: Filter[] };

function parseOr(str: string): Filter {
  const parts = str.split(",").map((p) => p.trim()).filter(Boolean);
  const filters: Filter[] = parts.map((p) => {
    const m = p.match(/^([\w.]+)\.(\w+)\.(.*)$/);
    if (!m) return { op: "ilike", column: p, value: "" };
    const [, col, op, val] = m;
    if (op === "ilike" || op === "like") return { op, column: col, value: val };
    if (op === "eq") return { op: "eq", column: col, value: val === "true" ? true : val === "false" ? false : isNaN(Number(val)) ? val : Number(val) };
    if (op === "is") return { op: "is", column: col, value: val === "null" ? null : val };
    return { op: "eq", column: col, value: val };
  });
  return { op: "or", filters };
}

interface SelectSpec { columns: string[]; embed: Record<string, string[] | "*"> }

function project(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) out[c] = row[c];
  return out;
}

function parseSelect(sel: string | undefined): SelectSpec {
  if (!sel || sel.trim() === "") return { columns: ["*"], embed: {} };
  const embed: Record<string, string[] | "*"> = {};
  const columns: string[] = [];
  // regex para embeds: nome(c1,c2) ou nome(*)
  const embedRe = /([a-zA-Z_][\w]*)\(([^)]*)\)/g;
  let rest = sel;
  let m;
  while ((m = embedRe.exec(sel)) !== null) {
    const alias = m[1];
    const inner = m[2].trim();
    embed[alias] = inner === "*" ? "*" : inner.split(",").map((s) => s.trim()).filter(Boolean);
    rest = rest.replace(m[0], "");
  }
  const cols = rest.split(",").map((s) => s.trim()).filter(Boolean);
  if (cols.length === 0) columns.push("*");
  else columns.push(...cols);
  return { columns, embed };
}

class QueryBuilder {
  private table: string;
  private _select: SelectSpec = { columns: ["*"], embed: {} };
  private _filters: Filter[] = [];
  private _order: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private _limit?: number;
  private _offset?: number;
  private _count = false;
  private _single: "single" | "maybe" | null = null;
  private _op: "select" | "insert" | "update" | "delete" = "select";
  private _rows: unknown = null;
  private _values: unknown = null;
  private _returning: string[] | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string, options?: { count?: "exact" }) {
    if (this._op === "insert" || this._op === "update" || this._op === "delete") {
      this._returning = parseSelect(columns).columns.filter((c) => c !== "*");
      return this;
    }
    this._op = "select";
    this._select = parseSelect(columns);
    if (options?.count) this._count = true;
    return this;
  }
  insert(rows: unknown) { this._op = "insert"; this._rows = rows; return this; }
  update(values: unknown) { this._op = "update"; this._values = values; return this; }
  delete() { this._op = "delete"; return this; }

  eq(column: string, value: unknown) { this._filters.push({ op: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this._filters.push({ op: "neq", column, value }); return this; }
  gt(column: string, value: unknown) { this._filters.push({ op: "gt", column, value }); return this; }
  gte(column: string, value: unknown) { this._filters.push({ op: "gte", column, value }); return this; }
  lt(column: string, value: unknown) { this._filters.push({ op: "lt", column, value }); return this; }
  lte(column: string, value: unknown) { this._filters.push({ op: "lte", column, value }); return this; }
  in(column: string, values: unknown[]) { this._filters.push({ op: "in", column, values }); return this; }
  is(column: string, value: unknown) { this._filters.push({ op: "is", column, value }); return this; }
  not(column: string, subop: "eq" | "is" | "in", value: unknown) { this._filters.push({ op: "not", column, subop, value }); return this; }
  like(column: string, value: string) { this._filters.push({ op: "like", column, value }); return this; }
  ilike(column: string, value: string) { this._filters.push({ op: "ilike", column, value }); return this; }
  or(query: string) { this._filters.push(parseOr(query)); return this; }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this._order.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst });
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  range(from: number, to: number) { this._offset = from; this._limit = to - from + 1; return this; }
  single() { this._single = "single"; return this; }
  maybeSingle() { this._single = "maybe"; return this; }

  async _execute(): Promise<HttpResponse> {
    switch (this._op) {
      case "select": {
        const res = await http("POST", "/api/rest/select", {
          table: this.table,
          columns: this._select.columns,
          embed: this._select.embed,
          filters: this._filters,
          order: this._order,
          limit: this._limit,
          offset: this._offset,
          count: this._count,
        });
        if (res.error) return res;
        let rows = res.data?.rows ?? [];
        if (this._single === "maybe" && rows.length === 0) return { data: null, error: null };
        if (this._single === "single") {
          if (rows.length === 0) return { data: null, error: new Error("Nenhum registro encontrado") };
          if (rows.length > 1) return { data: null, error: new Error("Mais de um registro encontrado") };
          rows = rows[0];
        }
        const out: any = { data: rows, error: null };
        if (this._count) out.count = res.data?.count ?? 0;
        return out;
      }
      case "insert": {
        const rows = Array.isArray(this._rows) ? this._rows : [this._rows];
        const res = await http("POST", "/api/rest/insert", { table: this.table, rows });
        if (res.error) return res;
        let data = res.data?.rows ?? [];
        if (this._returning) data = data.map((r: any) => project(r, this._returning!));
        if (this._single) data = data[0] ?? null;
        return { data, error: null };
      }
      case "update": {
        const res = await http("POST", "/api/rest/update", { table: this.table, values: this._values, filters: this._filters });
        if (res.error) return res;
        return { data: res.data ?? [], error: null };
      }
      case "delete": {
        const res = await http("POST", "/api/rest/delete", { table: this.table, filters: this._filters });
        if (res.error) return res;
        return { data: res.data ?? [], error: null };
      }
      default:
        return { data: null, error: new Error("Operação inválida") };
    }
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------- auth
const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const res = await http("POST", "/api/auth/login", { email, password });
    if (res.error) return { data: null, error: res.error };
    setToken(res.data.token);
    currentUser = res.data.user;
    return { data: { user: res.data.user, session: { access_token: res.data.token, user: res.data.user } }, error: null };
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: any }) {
    const res = await http("POST", "/api/auth/signup", { email, password, full_name: options?.data?.full_name });
    if (res.error) return { data: null, error: res.error };
    setToken(res.data.token);
    currentUser = res.data.user;
    return { data: { user: res.data.user, session: { access_token: res.data.token, user: res.data.user } }, error: null };
  },
  async signOut() {
    setToken(null);
    currentUser = null;
    notifyAuthChange(null);
    return { error: null };
  },
  async getSession() {
    if (!currentToken) return { data: { session: null }, error: null };
    if (currentUser) return { data: { session: { access_token: currentToken, user: currentUser } }, error: null };
    const res = await http("GET", "/api/auth/me");
    if (res.error) return { data: { session: null }, error: null };
    currentUser = res.data.user;
    return { data: { session: { access_token: currentToken, user: currentUser } }, error: null };
  },
  async getUser(token?: string) {
    if (!currentToken) return { data: { user: null }, error: null };
    if (currentUser) return { data: { user: currentUser }, error: null };
    const res = await http("GET", "/api/auth/me");
    if (res.error) return { data: { user: null }, error: null };
    currentUser = res.data.user;
    return { data: { user: currentUser }, error: null };
  },
  onAuthStateChange(callback: (event: string, session: any) => void) {
    const listeners = authListeners;
    const listener = (s: any) => callback("SIGNED_IN", s ? { user: s } : null);
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  },
};

const authListeners = new Set<(s: any) => void>();
function notifyAuthChange(user: AuthUser | null) {
  for (const l of authListeners) l(user);
}

// ---------------------------------------------------------------- channel (polling)
const channels = new Map<string, { name: string; handlers: (() => void)[]; timer: number | null }>();

function channel(name: string) {
  const handlers: (() => void)[] = [];
  const state = { name, handlers, timer: null as number | null };
  return {
    on(_event: string, _filter: any, cb: (payload: any) => void) {
      handlers.push(() => cb({}));
      return this;
    },
    subscribe(cb?: (status: string, err?: Error) => void) {
      // Polling simples: chama os handlers registrados a cada intervalo
      const POLL_MS = 10000;
      const tick = () => { for (const h of handlers) h(); };
      state.timer = window.setInterval(tick, POLL_MS);
      channels.set(name, state);
      cb?.("SUBSCRIBED");
      return this;
    },
    unsubscribe() {
      if (state.timer) window.clearInterval(state.timer);
      channels.delete(name);
      return this;
    },
  };
}

function removeChannel(ch: any) {
  ch?.unsubscribe?.();
}

// ---------------------------------------------------------------- functions / rpc
const functions = {
  async invoke(name: string, options?: { body?: unknown; method?: string }) {
    const res = await http("POST", `/api/functions/${name}`, options?.body);
    return res;
  },
};

async function rpc(fn: string, args: unknown) {
  return http("POST", `/api/rpc/${fn}`, args);
}

function from(table: string) {
  return new QueryBuilder(table);
}

const postgresApi = {
  from,
  rpc,
  auth,
  channel,
  removeChannel,
  functions,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = BACKEND === "supabase" ? supabaseApi : postgresApi;
export const authToken = BACKEND === "supabase" ? supabaseAuthToken : postgresAuthToken;
export const API_URL = BACKEND === "supabase" ? SUPABASE_URL : POSTGRES_API_URL;
