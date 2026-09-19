CREATE TABLE public.mikrotik_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  usuario_pppoe text NOT NULL,
  action text NOT NULL CHECK (action IN ('disable','enable','remove','sync')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX idx_mikrotik_commands_pending ON public.mikrotik_commands (status, created_at);

GRANT SELECT ON public.mikrotik_commands TO authenticated;
GRANT ALL ON public.mikrotik_commands TO service_role;

ALTER TABLE public.mikrotik_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view mikrotik commands"
ON public.mikrotik_commands FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Enqueue a router command whenever the customer block state changes
CREATE OR REPLACE FUNCTION public.queue_mikrotik_block_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_should_block boolean;
  v_was_blocked boolean;
BEGIN
  IF NEW.usuario_pppoe IS NULL OR NEW.usuario_pppoe = '' THEN
    RETURN NEW;
  END IF;

  v_should_block := (NEW.block_status = 'blocked') OR (NEW.ativo = false);
  v_was_blocked := (OLD.block_status = 'blocked') OR (OLD.ativo = false);

  IF v_should_block IS DISTINCT FROM v_was_blocked THEN
    INSERT INTO public.mikrotik_commands (customer_id, usuario_pppoe, action, payload)
    VALUES (
      NEW.id,
      NEW.usuario_pppoe,
      CASE WHEN v_should_block THEN 'disable' ELSE 'enable' END,
      jsonb_build_object('password', NEW.senha_pppoe, 'nome', NEW.nome)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_mikrotik_block_command
AFTER UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.queue_mikrotik_block_command();