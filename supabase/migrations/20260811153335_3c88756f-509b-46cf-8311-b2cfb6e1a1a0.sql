CREATE TABLE IF NOT EXISTS public.wan_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  interface_name TEXT NOT NULL,
  rx_bps BIGINT NOT NULL DEFAULT 0,
  tx_bps BIGINT NOT NULL DEFAULT 0,
  rx_bytes BIGINT,
  tx_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wan_logs_created_at_idx ON public.wan_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS wan_logs_iface_created_idx ON public.wan_logs (interface_name, created_at DESC);

GRANT SELECT ON public.wan_logs TO authenticated;
GRANT ALL ON public.wan_logs TO service_role;

ALTER TABLE public.wan_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view wan logs" ON public.wan_logs;
CREATE POLICY "Authenticated users can view wan logs"
ON public.wan_logs FOR SELECT TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.wan_logs;