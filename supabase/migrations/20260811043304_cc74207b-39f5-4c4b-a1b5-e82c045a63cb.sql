-- Migration to create block_history table and update blocking logic with audit trail

CREATE TABLE IF NOT EXISTS public.block_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
    old_status text,
    new_status text NOT NULL,
    reason text,
    created_at timestamptz DEFAULT now() NOT NULL,
    changed_by uuid REFERENCES auth.users(id) -- NULL if automatic
);

-- Grant permissions
GRANT SELECT ON public.block_history TO authenticated;
GRANT ALL ON public.block_history TO service_role;

-- Enable RLS
ALTER TABLE public.block_history ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read all history
CREATE POLICY "Authenticated users can read block history" ON public.block_history
    FOR SELECT TO authenticated USING (true);

-- Update the check_and_block_overdue_customers function to include history logging
CREATE OR REPLACE FUNCTION public.check_and_block_overdue_customers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id uuid;
    v_blocking_days text;
    v_days_interval interval;
    v_old_status text;
BEGIN
    -- Get the custom blocking days from settings, default to 15
    SELECT value INTO v_blocking_days FROM public.settings WHERE key = 'blocking_days';
    
    IF v_blocking_days IS NULL OR v_blocking_days = '' THEN
        v_blocking_days := '15';
    END IF;
    
    v_days_interval := (v_blocking_days || ' days')::interval;

    -- 1. IDENTIFY CUSTOMERS TO BLOCK
    FOR v_customer_id IN
        SELECT DISTINCT c.id
        FROM public.customers c
        JOIN public.invoices i ON i.customer_id = c.id
        WHERE i.status IN ('pending', 'overdue')
          AND i.vencimento <= CURRENT_DATE - v_days_interval
          AND c.block_status = 'active'
          AND c.ativo = true
    LOOP
        -- Log history
        INSERT INTO public.block_history (customer_id, old_status, new_status, reason)
        VALUES (v_customer_id, 'active', 'blocked', 'Bloqueio automático por faturas vencidas (' || v_blocking_days || ' dias)');

        -- Update customer
        UPDATE public.customers
        SET block_status = 'blocked'
        WHERE id = v_customer_id;
    END LOOP;

    -- 2. IDENTIFY CUSTOMERS TO UNBLOCK
    FOR v_customer_id IN
        SELECT c.id
        FROM public.customers c
        WHERE c.block_status = 'blocked'
          AND NOT EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.customer_id = c.id
              AND i.status IN ('pending', 'overdue')
              AND i.vencimento <= CURRENT_DATE - v_days_interval
          )
    LOOP
        -- Log history
        INSERT INTO public.block_history (customer_id, old_status, new_status, reason)
        VALUES (v_customer_id, 'blocked', 'active', 'Desbloqueio automático (faturas regularizadas)');

        -- Update customer
        UPDATE public.customers
        SET block_status = 'active'
        WHERE id = v_customer_id;
    END LOOP;
END;
$$;
