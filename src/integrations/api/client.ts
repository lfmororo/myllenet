// Cliente do painel: Supabase (Edge Functions + PostgREST + Auth).
// O backend alternativo Fastify + PostgreSQL (pasta server/, flag VITE_BACKEND) foi removido em nov/2026:
// nunca chegou a ser usado em produção e deixava a fatura pública e o painel de backup quebrados.
import { supabaseApi, supabaseAuthToken, SUPABASE_URL } from "@/integrations/api/supabaseAdapter";
import type { AuthUser } from "@/integrations/types";

export type { AuthUser };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = supabaseApi;
export const authToken = supabaseAuthToken;
export const API_URL = SUPABASE_URL;
