CREATE TABLE public.customer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text,
  telefone text,
  rating integer NOT NULL,
  tipo text NOT NULL DEFAULT 'satisfacao',
  mensagem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.customer_feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_feedback TO authenticated;
GRANT ALL ON public.customer_feedback TO service_role;

ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit feedback" ON public.customer_feedback
  FOR INSERT TO anon, authenticated WITH CHECK (rating BETWEEN 1 AND 5 AND tipo IN ('satisfacao','solicitacao','reclamacao'));

CREATE POLICY "Admins can read feedback" ON public.customer_feedback
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete feedback" ON public.customer_feedback
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
