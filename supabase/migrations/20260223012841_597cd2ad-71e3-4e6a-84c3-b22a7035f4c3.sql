
CREATE TABLE public.efi_api_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  method text NOT NULL,
  endpoint text NOT NULL,
  status_code integer,
  request_body text,
  response_body text,
  error_message text,
  duration_ms integer,
  context text
);

ALTER TABLE public.efi_api_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage efi_api_logs"
  ON public.efi_api_logs
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));
