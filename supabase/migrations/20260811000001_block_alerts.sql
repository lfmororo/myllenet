-- Adiciona flag para controle de alertas de bloqueio
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS alert_on_block_change boolean DEFAULT true;

-- Tabela para log de alertas de bloqueio enviados (evita spam)
CREATE TABLE IF NOT EXISTS public.block_alerts_sent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    old_status text,
    new_status text,
    sent_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT ON public.block_alerts_sent TO authenticated;
GRANT ALL ON public.block_alerts_sent TO service_role;

ALTER TABLE public.block_alerts_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read block alerts" ON public.block_alerts_sent FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Trigger ou função para detectar mudança de block_status e enviar alerta via edge function
-- No Supabase, é melhor usar um Webhook ou uma função que chama o WhatsApp.
-- Como já temos o check_and_block_overdue_customers, vamos injetar a lógica de notificação lá.
