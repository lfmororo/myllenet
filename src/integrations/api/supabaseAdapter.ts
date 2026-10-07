// Adaptador Supabase: expõe a mesma superfície `api` do frontend,
// mas por baixo usa supabase-js diretamente (client criado sob demanda).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/integrations/types";

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || "";
const PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || "";

let _client: SupabaseClient | null = null;
let _token: string | null = null;

function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    _client.auth.onAuthStateChange((_event, session) => {
      _token = session?.access_token ?? null;
    });
    _client.auth.getSession().then(({ data }) => {
      _token = data.session?.access_token ?? null;
    });
  }
  return _client;
}

async function augmentUser(u: any): Promise<AuthUser | null> {
  if (!u) return null;
  try {
    const [roleData, perms] = await Promise.all([
      client().from("user_roles").select("role").eq("user_id", u.id).eq("role", "admin").maybeSingle(),
      client().from("user_report_permissions").select("report_key").eq("user_id", u.id),
    ]);
    return {
      id: u.id,
      email: u.email ?? "",
      full_name: u.user_metadata?.full_name ?? null,
      phone: u.user_metadata?.phone ?? u.phone ?? null,
      role: roleData?.data ? "admin" : "user",
      report_permissions: (perms?.data ?? []).map((p: any) => p.report_key),
    };
  } catch {
    return {
      id: u.id,
      email: u.email ?? "",
      full_name: u.user_metadata?.full_name ?? null,
      phone: u.user_metadata?.phone ?? u.phone ?? null,
      role: "user",
      report_permissions: [],
    };
  }
}

export function supabaseAuthToken(): string | null {
  return _token;
}

export const supabaseApi = {
  from: (table: string) => client().from(table),
  rpc: (fn: string, args: any) => client().rpc(fn, args),
  channel: (name: string) => client().channel(name),
  removeChannel: (ch: any) => client().removeChannel(ch),
  functions: {
    async invoke(name: string, options?: { body?: unknown; method?: string }) {
      const method = options?.method ?? "POST";
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method,
        headers: {
          Authorization: `Bearer ${_token}`,
          "Content-Type": "application/json",
          apikey: PUBLISHABLE_KEY,
        },
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { data: null, error: new Error(data?.error || `HTTP ${res.status}`) };
      return { data, error: null };
    },
  },
  auth: {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) return { data: null, error };
      const user = await augmentUser(data.user);
      return { data: { user, session: data.session }, error: null };
    },
    async signUp({ email, password, options }: any) {
      const { data, error } = await client().auth.signUp({ email, password, options });
      if (error) return { data: null, error };
      const user = await augmentUser(data.user);
      return { data: { user, session: data.session }, error: null };
    },
    async signOut() {
      const { error } = await client().auth.signOut();
      return { error };
    },
    async getSession() {
      const { data } = await client().auth.getSession();
      if (!data.session) return { data: { session: null }, error: null };
      const user = await augmentUser(data.session.user);
      return { data: { session: { access_token: data.session.access_token, user } }, error: null };
    },
    async getUser() {
      const { data } = await client().auth.getUser();
      if (!data.user) return { data: { user: null }, error: null };
      const user = await augmentUser(data.user);
      return { data: { user }, error: null };
    },
    onAuthStateChange(cb: (event: string, session: any) => void) {
      // Não usar await dentro do callback: chamadas ao banco aqui travam o login.
      const { data } = client().auth.onAuthStateChange((_event, session) => {
        _token = session?.access_token ?? null;
        if (session?.user) {
          setTimeout(() => {
            augmentUser(session.user).then((user) =>
              cb("SIGNED_IN", { access_token: session.access_token, user })
            );
          }, 0);
        } else {
          cb("SIGNED_OUT", null);
        }
      });
      return { data: { subscription: data.subscription } };
    },
  },
};
