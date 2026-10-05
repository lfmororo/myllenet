import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { api, type AuthUser } from "@/integrations/api/client";

interface AuthContextType {
  user: AuthUser | null;
  session: { access_token: string; user: AuthUser } | null;
  isAdmin: boolean;
  reportPermissions: string[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<{ access_token: string; user: AuthUser } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = api.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      setSession(session && u ? { access_token: session.access_token ?? "", user: u } : null);
      setLoading(false);
    });

    api.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setSession({ access_token: session.access_token, user: session.user });
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await api.auth.signInWithPassword({ email, password });
    if (!error && data?.user) {
      setUser(data.user);
      setSession({ access_token: data.session.access_token, user: data.user });
    }
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await api.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (!error && data?.user) {
      setUser(data.user);
      setSession({ access_token: data.session.access_token, user: data.user });
    }
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await api.auth.signOut();
    setUser(null);
    setSession(null);
  };

  const isAdmin = user?.role === "admin";
  const reportPermissions = user?.report_permissions ?? [];

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, reportPermissions, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
