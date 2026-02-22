
-- Add discount, interest and fine columns to plans
ALTER TABLE public.plans ADD COLUMN desconto_centavos integer NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN juros_mensal numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN multa_centavos integer NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN dias_desconto integer NOT NULL DEFAULT 0;
