
-- Schedule Mikrotik Synchronization every 15 minutes
SELECT cron.schedule('mikrotik-sync-every-15min', '*/15 * * * *', 'SELECT net.http_post(
    url := (SELECT value FROM public.settings WHERE key = ''supabase_url'') || ''/functions/v1/mikrotik-sync'',
    headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer '' || (SELECT value FROM public.settings WHERE key = ''supabase_service_role_key'')
    ),
    body := ''{}''::jsonb
)');
