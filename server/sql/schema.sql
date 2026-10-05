-- =============================================================
-- myllenet - schema PostgreSQL (sem Supabase)
-- Substitui auth.users por tabela própria, sem RLS (auth no app)
-- =============================================================

-- Usuários (substitui auth.users)
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  valor_centavos integer NOT NULL,
  intervalo_meses integer NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  desconto_centavos integer NOT NULL DEFAULT 0,
  juros_mensal numeric(5,2) NOT NULL DEFAULT 0,
  multa_centavos integer NOT NULL DEFAULT 0,
  dias_desconto integer NOT NULL DEFAULT 0,
  nome_servidor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cpf text NOT NULL UNIQUE,
  email text NOT NULL,
  telefone text,
  usuario_pppoe text NOT NULL,
  senha_pppoe text NOT NULL,
  rua text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  cep text,
  ativo boolean NOT NULL DEFAULT true,
  dia_vencimento integer NOT NULL DEFAULT 10,
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  desconto_especial_centavos integer NOT NULL DEFAULT 0,
  pago_ate date,
  cortesia boolean NOT NULL DEFAULT false,
  alert_on_disconnect boolean NOT NULL DEFAULT true,
  alert_on_frequent_drops boolean NOT NULL DEFAULT true,
  alert_on_abnormal_usage boolean NOT NULL DEFAULT true,
  alert_on_block_change boolean NOT NULL DEFAULT true,
  block_alerts_enabled boolean NOT NULL DEFAULT true,
  block_status text NOT NULL DEFAULT 'active' CHECK (block_status IN ('active','blocked')),
  seller_name text,
  preferred_payment_method text,
  pop_name text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unicidade parcial: apenas clientes ativos têm usuario_pppoe único
CREATE UNIQUE INDEX customers_usuario_pppoe_ativo_unique ON customers (usuario_pppoe) WHERE (ativo = true);
CREATE INDEX idx_customers_plan ON customers (plan_id);
CREATE INDEX idx_customers_reporting ON customers (ativo, plan_id, cidade, bairro);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  valor_centavos integer NOT NULL,
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  efi_charge_id integer,
  efi_barcode text,
  efi_pix_qrcode text,
  efi_pix_copiacola text,
  efi_link text,
  gateway text NOT NULL DEFAULT 'efi',
  mp_payment_id text,
  mp_pix_qrcode text,
  mp_pix_copiacola text,
  mp_link text,
  payment_method text,
  gateway_fee_centavos integer NOT NULL DEFAULT 0,
  net_amount_centavos integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, vencimento)
);

CREATE INDEX idx_invoices_customer ON invoices (customer_id);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_efi_charge ON invoices (efi_charge_id);
CREATE INDEX idx_invoices_reporting ON invoices (vencimento, status, gateway);
CREATE INDEX idx_invoices_mp ON invoices (mp_payment_id);
CREATE INDEX idx_invoices_gateway_status ON invoices (gateway, status);

CREATE TABLE settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  phone text,
  type text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_customer ON notification_logs (customer_id);
CREATE INDEX idx_notif_created ON notification_logs (created_at);
CREATE INDEX idx_notif_type ON notification_logs (type);

CREATE TABLE efi_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  endpoint text NOT NULL,
  status_code integer,
  request_body text,
  response_body text,
  error_message text,
  duration_ms integer,
  context text
);

CREATE TABLE pppoe_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  usuario_pppoe text NOT NULL,
  dropped_at timestamptz DEFAULT now(),
  last_uptime text,
  reason text
);
CREATE INDEX idx_drops_customer ON pppoe_drops (customer_id);

CREATE TABLE customer_alerts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  sent_at timestamptz DEFAULT now()
);
CREATE INDEX idx_alerts_customer ON customer_alerts_sent (customer_id);

CREATE TABLE wan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interface_name text NOT NULL,
  rx_bps bigint NOT NULL DEFAULT 0,
  tx_bps bigint NOT NULL DEFAULT 0,
  rx_bytes bigint,
  tx_bytes bigint,
  cpu_load double precision,
  free_memory bigint,
  total_memory bigint,
  temperature double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wan_created ON wan_logs (created_at);
CREATE INDEX idx_wan_iface ON wan_logs (interface_name, created_at);

CREATE TABLE block_alerts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  old_status text,
  new_status text NOT NULL,
  processed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_block_alerts_customer ON block_alerts_sent (customer_id);

CREATE TABLE block_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);
CREATE INDEX idx_block_history_customer ON block_history (customer_id);

CREATE TABLE pppoe_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  usuario_pppoe text NOT NULL,
  ip_address text,
  uptime text,
  rx_bytes bigint DEFAULT 0,
  tx_bytes bigint DEFAULT 0,
  event_type text NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pppoe_customer_time ON pppoe_logs (customer_id, logged_at);
CREATE INDEX idx_pppoe_reporting ON pppoe_logs (logged_at, customer_id);

CREATE TABLE mikrotik_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL,
  online boolean NOT NULL,
  message text,
  diagnostics jsonb,
  logged_at timestamptz DEFAULT now()
);

CREATE TABLE wan_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interface_name text NOT NULL,
  status text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  last_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mikrotik_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  usuario_pppoe text NOT NULL,
  action text NOT NULL CHECK (action IN ('disable','enable','remove','sync')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);
CREATE INDEX idx_mikrotik_commands_pending ON mikrotik_commands (status, created_at);

CREATE TABLE mikrotik_pppoe_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  collection_ok boolean NOT NULL DEFAULT true,
  usernames jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX idx_snapshots_collected ON mikrotik_pppoe_snapshots (collected_at);

CREATE TABLE customer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text,
  telefone text,
  rating integer NOT NULL,
  tipo text NOT NULL DEFAULT 'satisfacao',
  mensagem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_report_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_key)
);
CREATE INDEX idx_user_report_user ON user_report_permissions (user_id);

-- Trigger genérico de updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_tokens_updated_at BEFORE UPDATE ON agent_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Configurações iniciais
INSERT INTO settings ("key", value) VALUES
  ('pix_key', ''),
  ('pix_name', 'Mororo Tech'),
  ('pix_city', 'Ipu'),
  ('blocking_days', '15'),
  ('mikrotik_speed_threshold_mbps', '10'),
  ('mikrotik_alert_interval_minutes', '30')
ON CONFLICT ("key") DO NOTHING;
