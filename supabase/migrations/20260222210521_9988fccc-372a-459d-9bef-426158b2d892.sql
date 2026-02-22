
-- Add billing fields to customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS dia_vencimento integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS desconto_especial_centavos integer NOT NULL DEFAULT 0;
