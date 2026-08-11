-- Migration to add blocking_days setting and update the blocking logic
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS block_alerts_enabled boolean DEFAULT true;

-- Update the check_and_block_overdue_customers function to use the dynamic setting
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
BEGIN
    -- Get the custom blocking days from settings, default to 15
    SELECT value INTO v_blocking_days FROM public.settings WHERE key = 'blocking_days';
    
    IF v_blocking_days IS NULL OR v_blocking_days = '' THEN
        v_blocking_days := '15';
    END IF;
    
    v_days_interval := (v_blocking_days || ' days')::interval;

    -- Identify customers with pending/overdue invoices older than X days
    FOR v_customer_id IN
        SELECT DISTINCT c.id
        FROM public.customers c
        JOIN public.invoices i ON i.customer_id = c.id
        WHERE i.status IN ('pending', 'overdue')
          AND i.vencimento <= CURRENT_DATE - v_days_interval
          AND c.block_status = 'active'
    LOOP
        -- Mark customer as blocked in database
        UPDATE public.customers
        SET block_status = 'blocked'
        WHERE id = v_customer_id;
    END LOOP;

    -- Unblock customers who have no overdue invoices beyond the interval
    UPDATE public.customers c
    SET block_status = 'active'
    WHERE block_status = 'blocked'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.customer_id = c.id
          AND i.status IN ('pending', 'overdue')
          AND i.vencimento <= CURRENT_DATE - v_days_interval
      );
END;
$$;

-- Grant permissions again to ensure they persist
GRANT EXECUTE ON FUNCTION public.check_and_block_overdue_customers() TO service_role;
