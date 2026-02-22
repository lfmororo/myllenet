
ALTER TABLE public.customers ADD COLUMN pago_ate DATE DEFAULT NULL;

COMMENT ON COLUMN public.customers.pago_ate IS 'Data até a qual o cliente pagou antecipadamente (ex: PIX direto). Meses até essa data não geram alerta de "sem boleto".';
