
-- Settings table for EFI API configuration
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write settings
CREATE POLICY "Admins can read settings"
  ON public.settings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert settings"
  ON public.settings FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update settings"
  ON public.settings FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for certificates
INSERT INTO storage.buckets (id, name, public) VALUES ('certificates', 'certificates', false);

CREATE POLICY "Admins can upload certificates"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'certificates' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can read certificates"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'certificates' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update certificates"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'certificates' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete certificates"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'certificates' AND public.has_role(auth.uid(), 'admin'));
