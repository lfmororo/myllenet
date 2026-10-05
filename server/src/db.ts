import pg from "pg";
import { config } from "./config.js";

// Retorna datas/timestamps como string (paridade com PostgREST/Supabase)
pg.types.setTypeParser(1082, (v) => v); // date -> string
pg.types.setTypeParser(1114, (v) => v); // timestamp -> string
pg.types.setTypeParser(1184, (v) => v); // timestamptz -> string
// BIGINT (int8) -> number (rx_bytes, tx_bytes, free_memory, ...)
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
// NUMERIC -> number (juros_mensal)
pg.types.setTypeParser(1700, (v) => parseFloat(v));

export const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 10,
});

// Converte SQL no estilo `` `ident` `` e `?` para Postgres (`"ident"` e `$n`)
function transform(sql: string): string {
  let s = sql.replace(/`([^`]+)`/g, '"$1"');
  let i = 0;
  s = s.replace(/\?/g, () => `$${++i}`);
  return s;
}

export async function query<T = any[]>(sql: string, params: any[] = []): Promise<T> {
  const r = await pool.query(transform(sql), params);
  return r.rows as T;
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const r = await pool.query(transform(sql), params);
  return (r.rows[0] as T) ?? null;
}

export async function execute(sql: string, params: any[] = []): Promise<{ affectedRows: number }> {
  const r = await pool.query(transform(sql), params);
  return { affectedRows: r.rowCount ?? 0 };
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
