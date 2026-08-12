SELECT cron.schedule('mikrotik-sync-logs', '*/5 * * * *', 'SELECT net.http_post(
  url := (SELECT value FROM settings WHERE key = ''supabase_url'') || ''/functions/v1/mikrotik-sync-logs'',
  headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '' || (SELECT value FROM settings WHERE key = ''supabase_service_role_key'')),
  body := ''{}''
);');