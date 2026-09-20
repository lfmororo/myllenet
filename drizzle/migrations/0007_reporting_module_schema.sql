ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS preferred_payment_method text,
  ADD COLUMN IF NOT EXISTS pop_name text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS gateway_fee_centavos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_centavos integer;

CREATE TABLE public.user_report_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  report_key text NOT NULL CHECK (report_key IN ('overdue','blocked','customers','financial','bandwidth','missing_invoice','platforms')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_report_permissions TO authenticated;
GRANT ALL ON public.user_report_permissions TO service_role;
ALTER TABLE public.user_report_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_report_access(_user_id uuid, _report_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_report_permissions
      WHERE user_id = _user_id AND report_key = _report_key
    )
$$;

CREATE POLICY "Users can view own report permissions"
ON public.user_report_permissions FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert report permissions"
ON public.user_report_permissions FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update report permissions"
ON public.user_report_permissions FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete report permissions"
ON public.user_report_permissions FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_user_report_permissions_user ON public.user_report_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_reporting_filters ON public.customers(ativo, plan_id, cidade, bairro);
CREATE INDEX IF NOT EXISTS idx_invoices_reporting_period ON public.invoices(vencimento, status, gateway);
CREATE INDEX IF NOT EXISTS idx_pppoe_logs_reporting ON public.pppoe_logs(logged_at, customer_id);

CREATE OR REPLACE FUNCTION public.capture_customer_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo = false AND OLD.ativo = true THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  ELSIF NEW.ativo = true AND OLD.ativo = false THEN
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capture_customer_cancellation
BEFORE UPDATE OF ativo ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.capture_customer_cancellation();

GRANT EXECUTE ON FUNCTION public.has_report_access(uuid, text) TO authenticated, service_role;