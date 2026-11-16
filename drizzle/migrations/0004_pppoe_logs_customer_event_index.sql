SET LOCAL statement_timeout = '30min';
CREATE INDEX IF NOT EXISTS idx_pppoe_logs_customer_event_time ON public.pppoe_logs USING btree (customer_id, event_type, logged_at);