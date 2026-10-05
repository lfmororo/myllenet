// Whitelist de tabelas e colunas. Toda coluna usada em queries é validada aqui
// para impedir SQL injection via PostgREST-like generic endpoint.

export interface Relation {
  alias: string; // e.g. "customers"
  fkColumn: string; // e.g. "customer_id"
  refTable: string;
  refColumn: string; // e.g. "id"
}

const RELATIONS: Record<string, Relation[]> = {
  invoices: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
    { alias: "plans", fkColumn: "plan_id", refTable: "plans", refColumn: "id" },
  ],
  customers: [
    { alias: "plans", fkColumn: "plan_id", refTable: "plans", refColumn: "id" },
  ],
  notification_logs: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
  block_alerts_sent: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
    { alias: "invoices", fkColumn: "invoice_id", refTable: "invoices", refColumn: "id" },
  ],
  block_history: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
  pppoe_logs: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
  pppoe_drops: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
  customer_alerts_sent: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
  mikrotik_commands: [
    { alias: "customers", fkColumn: "customer_id", refTable: "customers", refColumn: "id" },
  ],
};

const TABLES: Record<string, string[]> = {
  users: [
    "id", "email", "password_hash", "full_name", "phone", "created_at", "last_sign_in_at",
  ],
  user_roles: ["id", "user_id", "role", "created_at"],
  profiles: ["id", "user_id", "full_name", "created_at"],
  plans: [
    "id", "nome", "descricao", "valor_centavos", "intervalo_meses", "ativo",
    "desconto_centavos", "juros_mensal", "multa_centavos", "dias_desconto",
    "nome_servidor", "created_at", "updated_at",
  ],
  customers: [
    "id", "nome", "cpf", "email", "telefone", "usuario_pppoe", "senha_pppoe",
    "rua", "numero", "complemento", "bairro", "cidade", "estado", "cep",
    "ativo", "dia_vencimento", "plan_id", "desconto_especial_centavos", "pago_ate",
    "cortesia", "alert_on_disconnect", "alert_on_frequent_drops", "alert_on_abnormal_usage",
    "alert_on_block_change", "block_alerts_enabled", "block_status",
    "seller_name", "preferred_payment_method", "pop_name", "cancelled_at", "cancel_reason",
    "created_at", "updated_at",
  ],
  invoices: [
    "id", "customer_id", "plan_id", "descricao", "valor_centavos", "vencimento", "status",
    "efi_charge_id", "efi_barcode", "efi_pix_qrcode", "efi_pix_copiacola", "efi_link",
    "gateway", "mp_payment_id", "mp_pix_qrcode", "mp_pix_copiacola", "mp_link",
    "payment_method", "gateway_fee_centavos", "net_amount_centavos", "paid_at",
    "created_at", "updated_at",
  ],
  settings: ["id", "key", "value", "created_at", "updated_at"],
  notification_logs: [
    "id", "customer_id", "customer_name", "phone", "type", "message", "status",
    "error_message", "created_at",
  ],
  efi_api_logs: [
    "id", "created_at", "method", "endpoint", "status_code", "request_body",
    "response_body", "error_message", "duration_ms", "context",
  ],
  pppoe_drops: ["id", "customer_id", "usuario_pppoe", "dropped_at", "last_uptime", "reason"],
  customer_alerts_sent: ["id", "customer_id", "alert_type", "sent_at"],
  wan_logs: [
    "id", "interface_name", "rx_bps", "tx_bps", "rx_bytes", "tx_bytes",
    "cpu_load", "free_memory", "total_memory", "temperature", "created_at",
  ],
  block_alerts_sent: [
    "id", "customer_id", "invoice_id", "old_status", "new_status", "processed", "created_at",
  ],
  block_history: ["id", "customer_id", "old_status", "new_status", "reason", "created_at", "changed_by"],
  pppoe_logs: [
    "id", "customer_id", "usuario_pppoe", "ip_address", "uptime", "rx_bytes",
    "tx_bytes", "event_type", "logged_at",
  ],
  mikrotik_status_history: ["id", "host", "online", "message", "diagnostics", "logged_at"],
  wan_status_history: ["id", "interface_name", "status", "reason", "created_at"],
  agent_tokens: ["id", "name", "token", "active", "last_seen_at", "last_ip", "created_at", "updated_at"],
  mikrotik_commands: [
    "id", "customer_id", "usuario_pppoe", "action", "payload", "status",
    "attempts", "error_message", "result", "created_at", "executed_at",
  ],
  mikrotik_pppoe_snapshots: ["id", "host", "collected_at", "collection_ok", "usernames"],
  customer_feedback: ["id", "nome", "telefone", "rating", "tipo", "mensagem", "created_at"],
  user_report_permissions: ["id", "user_id", "report_key", "created_at"],
};

export function tableColumns(table: string): string[] | undefined {
  return TABLES[table];
}

export function tableRelations(table: string): Relation[] {
  return RELATIONS[table] ?? [];
}

export function isValidTable(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLES, table);
}

export function isValidColumn(table: string, column: string): boolean {
  const cols = TABLES[table];
  return !!cols && cols.includes(column);
}
