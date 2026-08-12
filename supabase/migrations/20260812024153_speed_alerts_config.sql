-- Adiciona chaves de configuração para alertas de velocidade
INSERT INTO settings (key, value) VALUES 
('mikrotik_speed_threshold_mbps', '10'),
('mikrotik_alert_interval_minutes', '30')
ON CONFLICT (key) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
