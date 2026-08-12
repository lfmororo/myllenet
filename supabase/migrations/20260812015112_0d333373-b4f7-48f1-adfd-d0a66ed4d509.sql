GRANT SELECT ON public.invoices TO anon;
GRANT SELECT ON public.customers TO anon;

-- Note: RLS policies might already exist or need adjustment. 
-- Since I don't know the exact current state of RLS on these tables, 
-- I'll add targeted policies if they don't conflict.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'invoices' AND policyname = 'Public invoices are viewable by everyone'
    ) THEN
        CREATE POLICY "Public invoices are viewable by everyone" ON public.invoices FOR SELECT TO anon USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'customers' AND policyname = 'Public customers are viewable by everyone'
    ) THEN
        CREATE POLICY "Public customers are viewable by everyone" ON public.customers FOR SELECT TO anon USING (true);
    END IF;
END
$$;
