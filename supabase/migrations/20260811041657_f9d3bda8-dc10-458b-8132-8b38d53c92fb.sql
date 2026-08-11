-- Function to check for frequent drops
CREATE OR REPLACE FUNCTION public.check_frequent_drops(time_threshold timestamptz, drop_count int)
RETURNS TABLE (customer_id uuid, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.customer_id,
        COUNT(DISTINCT l.uptime) as session_count
    FROM 
        pppoe_logs l
    WHERE 
        l.logged_at > time_threshold
    GROUP BY 
        l.customer_id
    HAVING 
        COUNT(DISTINCT l.uptime) >= drop_count;
END;
$$;

-- Function to check for abnormal usage
CREATE OR REPLACE FUNCTION public.check_abnormal_usage(bytes_threshold bigint)
RETURNS TABLE (customer_id uuid, total_bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.customer_id,
        MAX(l.rx_bytes + l.tx_bytes) - MIN(l.rx_bytes + l.tx_bytes) as diff_bytes
    FROM 
        pppoe_logs l
    WHERE 
        l.logged_at > (now() - interval '20 minutes')
    GROUP BY 
        l.customer_id
    HAVING 
        (MAX(l.rx_bytes + l.tx_bytes) - MIN(l.rx_bytes + l.tx_bytes)) > bytes_threshold;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_frequent_drops(timestamptz, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_abnormal_usage(bigint) TO authenticated, service_role;
