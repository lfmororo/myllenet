CREATE TABLE public.mikrotik_status_history (
    id uuid primary key default gen_random_uuid(),
    host text not null,
    online boolean not null,
    message text,
    logged_at timestamptz default now()
);

GRANT SELECT, INSERT ON public.mikrotik_status_history TO authenticated;
GRANT ALL ON public.mikrotik_status_history TO service_role;

ALTER TABLE public.mikrotik_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see history" ON public.mikrotik_status_history
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
