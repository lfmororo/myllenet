
-- Enable block_status column to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS block_status text DEFAULT 'active' CHECK (block_status IN ('active', 'blocked'));

-- Grant access
GRANT SELECT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

-- Function to check and block customers with invoices 15+ days overdue
CREATE OR REPLACE FUNCTION public.check_and_block_overdue_customers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_customer_id uuid;
BEGIN
    -- Identify customers with pending/overdue invoices older than 15 days
    FOR v_customer_id IN
        SELECT DISTINCT c.id
        FROM public.customers c
        JOIN public.invoices i ON i.customer_id = c.id
        WHERE i.status IN ('pending', 'overdue')
          AND i.vencimento <= CURRENT_DATE - INTERVAL '15 days'
          AND c.block_status = 'active'
    LOOP
        -- Mark customer as blocked in database
        UPDATE public.customers
        SET block_status = 'blocked'
        WHERE id = v_customer_id;
    END LOOP;

    -- Unblock customers who have no overdue invoices (all paid or within grace period)
    UPDATE public.customers c
    SET block_status = 'active'
    WHERE block_status = 'blocked'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.customer_id = c.id
          AND i.status IN ('pending', 'overdue')
          AND i.vencimento <= CURRENT_DATE - INTERVAL '15 days'
      );
END;
$$;

-- Schedule the blocking check daily at 02:00
-- (Using a standard Postgres function call pattern for cron)
SELECT cron.schedule('check-overdue-blocking', '0 2 * * *', 'SELECT public.check_and_block_overdue_customers()');

-- Grant on new function
GRANT EXECUTE ON FUNCTION public.check_and_block_overdue_customers() TO service_role;
