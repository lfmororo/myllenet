-- Adiciona configurações de alertas no cadastro de clientes
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS alert_on_disconnect boolean DEFAULT true;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS alert_on_frequent_drops boolean DEFAULT true;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS alert_on_abnormal_usage boolean DEFAULT true;

-- Tabela para rastrear quedas frequentes (drops)
CREATE TABLE IF NOT EXISTS public.pppoe_drops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    usuario_pppoe text NOT NULL,
    dropped_at timestamptz DEFAULT now(),
    last_uptime interval,
    reason text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pppoe_drops TO authenticated;
GRANT ALL ON public.pppoe_drops TO service_role;

-- Check if table exists before enabling RLS (standard precaution)
ALTER TABLE public.pppoe_drops ENABLE ROW LEVEL SECURITY;

-- Drop policy if it exists to avoid errors on retry
DROP POLICY IF EXISTS "Admins can view all drops" ON public.pppoe_drops;
CREATE POLICY "Admins can view all drops"
    ON public.pppoe_drops
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- Tabela para rastrear alertas enviados (evitar spam)
CREATE TABLE IF NOT EXISTS public.customer_alerts_sent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    alert_type text NOT NULL, -- 'disconnect', 'frequent_drops', 'abnormal_usage'
    sent_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_alerts_sent TO authenticated;
GRANT ALL ON public.customer_alerts_sent TO service_role;

ALTER TABLE public.customer_alerts_sent ENABLE ROW LEVEL SECURITY;
