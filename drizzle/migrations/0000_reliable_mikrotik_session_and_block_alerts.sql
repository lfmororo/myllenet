CREATE TABLE public.mikrotik_pppoe_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  collection_ok boolean NOT NULL DEFAULT true,
  usernames jsonb NOT NULL DEFAULT '[]'::jsonb
);
GRANT SELECT ON public.mikrotik_pppoe_snapshots TO authenticated;
GRANT ALL ON public.mikrotik_pppoe_snapshots TO service_role;
ALTER TABLE public.mikrotik_pppoe_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view PPPoE snapshots"
ON public.mikrotik_pppoe_snapshots FOR SELECT TO authenticated USING (true);
CREATE INDEX mikrotik_pppoe_snapshots_collected_at_idx
ON public.mikrotik_pppoe_snapshots (collected_at DESC);

CREATE OR REPLACE FUNCTION public.queue_customer_block_status_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.block_status IS DISTINCT FROM OLD.block_status
     AND NEW.block_status IN ('active', 'blocked')
     AND NOT EXISTS (
       SELECT 1 FROM public.block_alerts_sent
       WHERE customer_id = NEW.id
         AND new_status = NEW.block_status
         AND created_at > now() - interval '10 minutes'
     ) THEN
    INSERT INTO public.block_alerts_sent (customer_id, new_status, processed)
    VALUES (NEW.id, NEW.block_status, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_customer_block_status_alert
AFTER UPDATE OF block_status ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.queue_customer_block_status_alert();