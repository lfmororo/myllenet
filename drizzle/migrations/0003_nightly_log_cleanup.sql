CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '25min'
AS $$
DECLARE
  n int;
  i int := 0;
BEGIN
  LOOP
    DELETE FROM public.pppoe_logs WHERE id IN (
      SELECT id FROM public.pppoe_logs WHERE logged_at < now() - interval '30 days' LIMIT 50000);
    GET DIAGNOSTICS n = ROW_COUNT;
    i := i + 1;
    EXIT WHEN n = 0 OR i >= 200;
  END LOOP;
  DELETE FROM public.mikrotik_status_history WHERE logged_at < now() - interval '30 days';
  DELETE FROM public.wan_logs WHERE created_at < now() - interval '30 days';
  DELETE FROM public.wan_status_history WHERE created_at < now() - interval '30 days';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_logs() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('nightly-log-cleanup', '30 6 * * *', $$SELECT public.cleanup_old_logs();$$);