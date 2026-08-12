-- Schedule the speedtest/metrics collection every hour
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

-- Ensure wan_logs has enough capacity or retention if needed
-- (Assuming table exists based on mikrotik-status code)
