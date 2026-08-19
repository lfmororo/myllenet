ALTER TABLE public.mikrotik_status_history ADD COLUMN IF NOT EXISTS diagnostics JSONB;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mikrotik_status_history TO authenticated;
GRANT ALL ON public.mikrotik_status_history TO service_role;