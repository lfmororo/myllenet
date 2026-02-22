
ALTER TABLE public.customers
  ADD COLUMN rua text,
  ADD COLUMN numero text,
  ADD COLUMN complemento text,
  ADD COLUMN bairro text,
  ADD COLUMN cidade text,
  ADD COLUMN estado text,
  ADD COLUMN cep text;
