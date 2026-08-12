CREATE TABLE IF NOT EXISTS public.block_alerts_sent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
    new_status text NOT NULL,
    processed boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.block_alerts_sent TO authenticated;
GRANT ALL ON public.block_alerts_sent TO service_role;

ALTER TABLE public.block_alerts_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage block alerts" ON public.block_alerts_sent
    FOR ALL TO authenticated USING (true);
