ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'efi',
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_pix_qrcode TEXT,
  ADD COLUMN IF NOT EXISTS mp_pix_copiacola TEXT,
  ADD COLUMN IF NOT EXISTS mp_link TEXT;

CREATE INDEX IF NOT EXISTS invoices_mp_payment_id_idx ON public.invoices (mp_payment_id);
CREATE INDEX IF NOT EXISTS invoices_gateway_status_idx ON public.invoices (gateway, status);