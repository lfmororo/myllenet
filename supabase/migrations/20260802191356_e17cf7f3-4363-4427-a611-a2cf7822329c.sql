UPDATE public.invoices 
SET status = 'paid', paid_at = now() 
WHERE customer_id = '38d4c663-22ef-488d-b1c2-9a5c10ab1d28' 
  AND status = 'overdue' 
  AND vencimento IN ('2026-06-13', '2026-07-13');