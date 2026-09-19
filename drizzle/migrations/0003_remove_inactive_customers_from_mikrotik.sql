CREATE OR REPLACE FUNCTION public.queue_mikrotik_block_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_should_block boolean;
  v_was_blocked boolean;
BEGIN
  IF NEW.usuario_pppoe IS NULL OR NEW.usuario_pppoe = '' THEN
    RETURN NEW;
  END IF;

  -- Cliente desativado: remover completamente do Mikrotik
  IF NEW.ativo = false AND OLD.ativo = true THEN
    INSERT INTO public.mikrotik_commands (customer_id, usuario_pppoe, action, payload)
    VALUES (NEW.id, NEW.usuario_pppoe, 'remove',
            jsonb_build_object('nome', NEW.nome, 'motivo', 'cliente desativado'));
    RETURN NEW;
  END IF;

  -- Cliente reativado: recriar o usuario no Mikrotik conforme o status de bloqueio
  IF NEW.ativo = true AND OLD.ativo = false THEN
    INSERT INTO public.mikrotik_commands (customer_id, usuario_pppoe, action, payload)
    VALUES (NEW.id, NEW.usuario_pppoe,
            CASE WHEN NEW.block_status = 'blocked' THEN 'disable' ELSE 'enable' END,
            jsonb_build_object('password', NEW.senha_pppoe, 'nome', NEW.nome));
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
$function$;

CREATE OR REPLACE FUNCTION public.queue_mikrotik_remove_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.usuario_pppoe IS NOT NULL AND OLD.usuario_pppoe <> '' THEN
    INSERT INTO public.mikrotik_commands (customer_id, usuario_pppoe, action, payload)
    VALUES (NULL, OLD.usuario_pppoe, 'remove',
            jsonb_build_object('nome', OLD.nome, 'motivo', 'cliente excluido'));
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS queue_mikrotik_remove_on_delete ON public.customers;
CREATE TRIGGER queue_mikrotik_remove_on_delete
AFTER DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.queue_mikrotik_remove_on_delete();