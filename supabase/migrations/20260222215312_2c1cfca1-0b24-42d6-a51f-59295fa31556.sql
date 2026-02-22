-- Remove duplicates keeping the most recent record (by created_at)
DELETE FROM public.invoices
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id, vencimento ORDER BY created_at DESC) as rn
    FROM public.invoices
  ) sub
  WHERE rn > 1
);

-- Now add the unique constraint
ALTER TABLE public.invoices ADD CONSTRAINT invoices_customer_vencimento_unique UNIQUE (customer_id, vencimento);