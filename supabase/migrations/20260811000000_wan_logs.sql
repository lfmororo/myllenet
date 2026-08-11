CREATE TABLE public.wan_logs (
    id uuid primary key default gen_random_uuid(),
    interface_name text not null,
    rx_bps bigint default 0,
    tx_bps bigint default 0,
    created_at timestamptz default now()
);

GRANT SELECT, INSERT ON public.wan_logs TO authenticated;
GRANT ALL ON public.wan_logs TO service_role;

ALTER TABLE public.wan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON public.wan_logs FOR SELECT TO authenticated USING (true);
