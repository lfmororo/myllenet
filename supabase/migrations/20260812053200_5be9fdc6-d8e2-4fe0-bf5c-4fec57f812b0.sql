-- Atualizando o agendamento do speedtest para ser executado a cada hora (no minuto 0)
SELECT cron.unschedule('mikrotik-periodic-metrics');

SELECT cron.schedule(
  'mikrotik-periodic-metrics',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM settings WHERE key = 'supabase_url') || '/functions/v1/mikrotik-speedtest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM settings WHERE key = 'supabase_service_role_key')
    ),
    body := '{}'
  )
  $$
);