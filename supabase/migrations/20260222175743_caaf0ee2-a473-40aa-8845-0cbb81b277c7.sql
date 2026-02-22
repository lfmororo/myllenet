
-- Trigger: primeiro usuário a se cadastrar vira admin automaticamente
CREATE OR REPLACE FUNCTION public.assign_first_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Se não existe nenhum admin ainda, o novo usuário vira admin
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_assign_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_first_admin();
