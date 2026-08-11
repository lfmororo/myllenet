CREATE TABLE public.pppoe_logs (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid references public.customers(id) on delete cascade not null,
    usuario_pppoe text not null,
    ip_address text,
    uptime text,
    rx_bytes bigint default 0,
    tx_bytes bigint default 0,
    event_type text not null, -- 'connected', 'disconnected', 'stats'
    logged_at timestamptz default now()
);

GRANT SELECT, INSERT ON public.pppoe_logs TO authenticated;
GRANT ALL ON public.pppoe_logs TO service_role;

ALTER TABLE public.pppoe_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see logs" ON public.pppoe_logs
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
