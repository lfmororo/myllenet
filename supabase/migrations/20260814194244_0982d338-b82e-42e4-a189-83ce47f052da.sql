CREATE TABLE public.agent_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  last_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tokens TO authenticated;
GRANT ALL ON public.agent_tokens TO service_role;

ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agent tokens"
ON public.agent_tokens FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_agent_tokens_updated_at
BEFORE UPDATE ON public.agent_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
