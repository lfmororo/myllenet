CREATE OR REPLACE FUNCTION public.queue_customer_block_status_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Bloqueio / desbloqueio
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

  -- Ativação / desativação do cliente
  IF NEW.ativo IS DISTINCT FROM OLD.ativo
     AND NOT EXISTS (
       SELECT 1 FROM public.block_alerts_sent
       WHERE customer_id = NEW.id
         AND new_status = CASE WHEN NEW.ativo THEN 'reactivated' ELSE 'deactivated' END
         AND created_at > now() - interval '10 minutes'
     ) THEN
    INSERT INTO public.block_alerts_sent (customer_id, new_status, processed)
    VALUES (NEW.id, CASE WHEN NEW.ativo THEN 'reactivated' ELSE 'deactivated' END, false);
  END IF;

  RETURN NEW;
END;
$function$;