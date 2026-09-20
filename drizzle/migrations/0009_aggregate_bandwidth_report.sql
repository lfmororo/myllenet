CREATE INDEX IF NOT EXISTS idx_pppoe_logs_customer_time
  ON public.pppoe_logs (customer_id, logged_at)
  WHERE rx_bytes IS NOT NULL AND tx_bytes IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_bandwidth_report(
  _from timestamp with time zone,
  _to timestamp with time zone
)
RETURNS TABLE (
  customer_id uuid,
  download_bytes bigint,
  upload_bytes bigint,
  total_bytes bigint,
  active_days integer,
  peak_bytes bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_report_access(auth.uid(), 'bandwidth') THEN
    RAISE EXCEPTION 'Acesso não autorizado ao relatório de consumo';
  END IF;

  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;

  RETURN QUERY
  WITH samples AS (
    SELECT
      l.customer_id,
      l.logged_at,
      l.rx_bytes,
      l.tx_bytes,
      lag(l.rx_bytes) OVER (PARTITION BY l.customer_id ORDER BY l.logged_at, l.id) AS previous_rx,
      lag(l.tx_bytes) OVER (PARTITION BY l.customer_id ORDER BY l.logged_at, l.id) AS previous_tx
    FROM public.pppoe_logs l
    WHERE l.logged_at >= _from - interval '1 day'
      AND l.logged_at <= _to
      AND l.rx_bytes IS NOT NULL
      AND l.tx_bytes IS NOT NULL
  ), deltas AS (
    SELECT
      s.customer_id,
      s.logged_at,
      CASE
        WHEN s.previous_tx IS NULL THEN 0::bigint
        WHEN s.tx_bytes >= s.previous_tx THEN s.tx_bytes - s.previous_tx
        ELSE s.tx_bytes
      END AS download_delta,
      CASE
        WHEN s.previous_rx IS NULL THEN 0::bigint
        WHEN s.rx_bytes >= s.previous_rx THEN s.rx_bytes - s.previous_rx
        ELSE s.rx_bytes
      END AS upload_delta
    FROM samples s
    WHERE s.logged_at >= _from
      AND s.logged_at <= _to
  )
  SELECT
    d.customer_id,
    COALESCE(sum(d.download_delta), 0)::bigint AS download_bytes,
    COALESCE(sum(d.upload_delta), 0)::bigint AS upload_bytes,
    COALESCE(sum(d.download_delta + d.upload_delta), 0)::bigint AS total_bytes,
    count(DISTINCT (d.logged_at AT TIME ZONE 'America/Sao_Paulo')::date)::integer AS active_days,
    COALESCE(max(d.download_delta + d.upload_delta), 0)::bigint AS peak_bytes
  FROM deltas d
  GROUP BY d.customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bandwidth_report(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bandwidth_report(timestamp with time zone, timestamp with time zone) TO service_role;