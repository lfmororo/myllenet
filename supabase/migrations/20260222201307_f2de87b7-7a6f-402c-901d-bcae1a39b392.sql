
-- Add ativo column
ALTER TABLE public.customers ADD COLUMN ativo boolean NOT NULL DEFAULT true;

-- Drop existing unique constraint on usuario_pppoe if exists
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_usuario_pppoe_key;

-- Create partial unique index: only active customers must have unique usuario_pppoe
CREATE UNIQUE INDEX customers_usuario_pppoe_ativo_unique ON public.customers (usuario_pppoe) WHERE (ativo = true);
