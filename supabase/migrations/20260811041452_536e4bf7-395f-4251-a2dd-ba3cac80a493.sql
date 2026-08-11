CREATE OR REPLACE FUNCTION public.get_recent_disconnections(since_time timestamptz)
RETURNS TABLE (
    customer_id uuid,
    usuario_pppoe text,
    nome text,
    last_seen timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH last_logs AS (
        -- Get the last time each customer was seen online (stats event)
        SELECT 
            pl.customer_id, 
            pl.usuario_pppoe, 
            MAX(pl.logged_at) as last_seen
        FROM public.pppoe_logs pl
        WHERE pl.event_type = 'stats'
        GROUP BY pl.customer_id, pl.usuario_pppoe
    ),
    active_now AS (
        -- Consider "active now" if they were seen in the last 2 minutes
        SELECT DISTINCT pl.customer_id
        FROM public.pppoe_logs pl
        WHERE pl.logged_at > now() - interval '2 minutes'
          AND pl.event_type = 'stats'
    )
    SELECT 
        ll.customer_id, 
        ll.usuario_pppoe, 
        c.nome, 
        ll.last_seen
    FROM last_logs ll
    JOIN public.customers c ON c.id = ll.customer_id
    LEFT JOIN active_now an ON an.customer_id = ll.customer_id
    WHERE an.customer_id IS NULL -- Not active now
      AND ll.last_seen < since_time -- Was last seen before the threshold (e.g. 5 min ago)
      AND ll.last_seen > now() - interval '1 hour' -- But was active recently (to avoid old alerts)
      AND c.ativo = true; -- Only active customers
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recent_disconnections TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_disconnections TO service_role;
