
CREATE TABLE public.notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage notification_logs"
  ON public.notification_logs
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_notification_logs_customer ON public.notification_logs(customer_id);
CREATE INDEX idx_notification_logs_created ON public.notification_logs(created_at DESC);
CREATE INDEX idx_notification_logs_type ON public.notification_logs(type);
