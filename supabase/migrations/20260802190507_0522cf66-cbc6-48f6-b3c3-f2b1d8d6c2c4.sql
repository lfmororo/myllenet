SELECT cron.schedule(
  'bulk-check-payments-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://bleenvuqsrvkmxwaoswb.supabase.co/functions/v1/efi-boleto/bulk-check',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsZWVudnVxc3J2a214d2Fvc3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3Nzk2MDgsImV4cCI6MjA4NzM1NTYwOH0.Ez4vB1Nn9rfjBk3dAo1w5HQT59NNSdHY_PKFgsu9ATQ"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);