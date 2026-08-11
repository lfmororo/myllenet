CREATE TABLE public.wan_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    interface_name text NOT NULL,
    status text NOT NULL, -- 'up', 'down'
    reason text,
    created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wan_status_history TO authenticated;
GRANT ALL ON public.wan_status_history TO service_role;

ALTER TABLE public.wan_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select wan_status_history" ON public.wan_status_history
    FOR SELECT TO authenticated USING (true);