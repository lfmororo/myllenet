// Script de migração de dados: Supabase (Postgres) -> PostgreSQL local
// Uso:
//   cd server
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=myllenet \
//   node scripts/migrate-data.mjs
import pg from "pg";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "myllenet",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "myllenet",
});

const JSON_COLS = {
  mikrotik_commands: ["payload", "result"],
  mikrotik_pppoe_snapshots: ["usernames"],
  mikrotik_status_history: ["diagnostics"],
};

async function fetchTable(table) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) {
    console.error(`Erro ao ler ${table}: ${res.status} ${await res.text()}`);
    return [];
  }
  return res.json();
}

function norm(table, col, val) {
  if (val === null || val === undefined) return null;
  if (JSON_COLS[table]?.includes(col) || (typeof val === "object")) return JSON.stringify(val);
  return val;
}

async function migrateTable(table, map = (r) => r) {
  const rows = await fetchTable(table);
  if (!rows.length) { console.log(`${table}: 0 registros`); return; }
  const cols = Object.keys(rows[0]);
  for (const row of rows) {
    const data = map(row);
    const keys = Object.keys(data);
    const values = keys.map((k) => norm(table, k, data[k]));
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
    try { await pool.query(sql, values); } catch (e) { console.error(`Falha em ${table} id=${row.id}:`, e.message); }
  }
  console.log(`${table}: ${rows.length} registros migrados`);
}

async function migrateUsers() {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users?per_page=1000`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) { console.error("Erro ao ler auth.users:", await res.text()); return; }
  const { users } = await res.json();
  for (const u of users) {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, full_name, phone, created_at, last_sign_in_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
      [u.id, u.email, "", u.user_metadata?.full_name || u.email, u.user_metadata?.phone || u.phone || null, u.created_at, u.last_sign_in_at]
    );
  }
  console.log(`users: ${users.length} registros migrados (senha vazia - redefinir)`);
}

async function main() {
  await migrateUsers();
  const tables = [
    "user_roles", "profiles", "plans", "customers", "invoices", "settings",
    "notification_logs", "efi_api_logs", "pppoe_drops", "customer_alerts_sent",
    "wan_logs", "block_alerts_sent", "block_history", "pppoe_logs",
    "mikrotik_status_history", "wan_status_history", "agent_tokens",
    "mikrotik_commands", "mikrotik_pppoe_snapshots", "customer_feedback",
    "user_report_permissions",
  ];
  for (const t of tables) await migrateTable(t);
  console.log("Migração concluída.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
