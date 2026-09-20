CREATE OR REPLACE FUNCTION public.get_invoice_network_metrics(
  _customer_id uuid,
  _from timestamp with time zone,
  _to timestamp with time zone
)
RETURNS TABLE(
  download_bytes bigint,
  upload_bytes bigint,
  disconnect_count integer,
  connected_seconds bigint,
  disconnected_seconds bigint,
  observed_from timestamp with time zone,
  observed_to timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _customer_id IS NULL OR _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Parâmetros inválidos';
  END IF;

  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Acesso não autorizado às métricas da fatura';
  END IF;

  RETURN QUERY
  WITH ordered_stats AS (
    SELECT
      l.logged_at,
      l.rx_bytes,
      l.tx_bytes,
      lag(l.logged_at) OVER (ORDER BY l.logged_at, l.id) AS previous_at,
      lag(l.rx_bytes) OVER (ORDER BY l.logged_at, l.id) AS previous_rx,
      lag(l.tx_bytes) OVER (ORDER BY l.logged_at, l.id) AS previous_tx,
      lead(l.logged_at) OVER (ORDER BY l.logged_at, l.id) AS next_at
    FROM public.pppoe_logs l
    WHERE l.customer_id = _customer_id
      AND l.event_type = 'stats'
      AND l.logged_at >= _from - interval '5 minutes'
      AND l.logged_at <= _to
      AND l.rx_bytes IS NOT NULL
      AND l.tx_bytes IS NOT NULL
  ), period_stats AS (
    SELECT * FROM ordered_stats
    WHERE logged_at >= _from AND logged_at <= _to
  ), totals AS (
    SELECT
      COALESCE(sum(CASE
        WHEN previous_tx IS NULL OR previous_at < _from - interval '2 minutes' THEN 0
        WHEN tx_bytes >= previous_tx THEN tx_bytes - previous_tx
        ELSE tx_bytes
      END), 0)::bigint AS download_bytes,
      COALESCE(sum(CASE
        WHEN previous_rx IS NULL OR previous_at < _from - interval '2 minutes' THEN 0
        WHEN rx_bytes >= previous_rx THEN rx_bytes - previous_rx
        ELSE rx_bytes
      END), 0)::bigint AS upload_bytes,
      COALESCE(sum(
        GREATEST(0, LEAST(
          120,
          extract(epoch FROM (LEAST(COALESCE(next_at, logged_at + interval '60 seconds'), _to) - logged_at))
        ))
      ), 0)::bigint AS connected_seconds,
      min(logged_at) AS observed_from,
      max(logged_at) AS observed_to
    FROM period_stats
  ), drops AS (
    SELECT count(*)::integer AS disconnect_count
    FROM public.pppoe_logs l
    WHERE l.customer_id = _customer_id
      AND l.event_type = 'disconnected'
      AND l.logged_at >= _from
      AND l.logged_at <= _to
  )
  SELECT
    t.download_bytes,
    t.upload_bytes,
    d.disconnect_count,
    t.connected_seconds,
    CASE
      WHEN t.observed_from IS NULL OR t.observed_to IS NULL THEN 0::bigint
      ELSE GREATEST(0, extract(epoch FROM (t.observed_to - t.observed_from))::bigint - t.connected_seconds)
    END AS disconnected_seconds,
    t.observed_from,
    t.observed_to
  FROM totals t CROSS JOIN drops d;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_invoice_network_metrics(uuid, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_network_metrics(uuid, timestamp with time zone, timestamp with time zone) TO service_role;