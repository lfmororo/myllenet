
INSERT INTO public.settings (key, value) VALUES ('pix_key', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.settings (key, value) VALUES ('pix_name', 'Mororo Tech') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.settings (key, value) VALUES ('pix_city', 'Ipu') ON CONFLICT (key) DO NOTHING;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
