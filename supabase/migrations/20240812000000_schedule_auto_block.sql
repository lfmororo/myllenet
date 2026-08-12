-- Schedule the 30-day auto-block task to run every day at 04:00 AM
SELECT cron.schedule(
    'auto-block-overdue-30d',
    '0 4 * * *',
    $$
    SELECT net.http_post(
        url := '${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-block-30d',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
    $$
);
