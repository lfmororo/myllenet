ALTER TABLE public.customers ADD COLUMN diagnostico_token uuid UNIQUE DEFAULT gen_random_uuid();
UPDATE public.customers SET diagnostico_token = gen_random_uuid() WHERE diagnostico_token IS NULL;

CREATE TABLE public.diagnosticos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL CHECK (origem IN ('navegador','windows','provedor')),
  ip_publico text,
  na_rede_provedor boolean,
  veredito text CHECK (veredito IN ('ok','alerta','falha')),
  download_mbps numeric, upload_mbps numeric, latencia_ms numeric, jitter_ms numeric, perda_pct numeric,
  user_agent text,
  dados jsonb NOT NULL,
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_analise','resolvido')),
  observacao text,
  atualizado_por uuid REFERENCES auth.users(id),
  atualizado_em timestamptz
);
CREATE INDEX idx_diagnosticos_cliente_criado ON public.diagnosticos (cliente_id, criado_em DESC);
CREATE INDEX idx_diagnosticos_status_criado ON public.diagnosticos (status, criado_em DESC);
GRANT SELECT, UPDATE ON public.diagnosticos TO authenticated;
GRANT ALL ON public.diagnosticos TO service_role;
ALTER TABLE public.diagnosticos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can select diagnosticos" ON public.diagnosticos FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins can update diagnosticos" ON public.diagnosticos FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.config_diagnostico (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  speedtest_url text,
  dns_curinga text,
  faixas_ip text[],
  sites jsonb DEFAULT '[{"nome":"Google","url":"https://www.google.com/favicon.ico"},{"nome":"YouTube","url":"https://www.youtube.com/favicon.ico"},{"nome":"WhatsApp","url":"https://web.whatsapp.com/favicon.ico"},{"nome":"Instagram","url":"https://www.instagram.com/favicon.ico"}]'::jsonb,
  duracao_ms int DEFAULT 8000,
  fluxos int DEFAULT 4,
  url_publica text,
  mensagem_whatsapp text DEFAULT 'Olá {nome}! Para analisarmos sua conexão, abra este link conectado ao Wi-Fi de casa e toque em Iniciar diagnóstico: {link}'
);
GRANT SELECT, UPDATE ON public.config_diagnostico TO authenticated;
GRANT ALL ON public.config_diagnostico TO service_role;
ALTER TABLE public.config_diagnostico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can select config_diagnostico" ON public.config_diagnostico FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins can update config_diagnostico" ON public.config_diagnostico FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
INSERT INTO public.config_diagnostico (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.diagnosticos;