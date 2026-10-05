import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query, execute } from "../db.js";
import { getSetting } from "../services/settings.js";

export async function registerRpcRoutes(app: FastifyInstance) {
  // get_bandwidth_report(_from, _to)
  app.post<{ Body: { _from: string; _to: string } }>("/api/rpc/get_bandwidth_report", async (req) => {
    const { _from, _to } = req.body;
    const rows = await query<Record<string, any>[]>(
      `WITH samples AS (
         SELECT l.customer_id, l.logged_at, l.rx_bytes, l.tx_bytes,
           lag(l.rx_bytes) OVER (PARTITION BY l.customer_id ORDER BY l.logged_at, l.id) AS previous_rx,
           lag(l.tx_bytes) OVER (PARTITION BY l.customer_id ORDER BY l.logged_at, l.id) AS previous_tx
         FROM pppoe_logs l
         WHERE l.logged_at >= (?::timestamptz - INTERVAL '1 day') AND l.logged_at <= ?
           AND l.rx_bytes IS NOT NULL AND l.tx_bytes IS NOT NULL
       ), deltas AS (
         SELECT s.customer_id, s.logged_at,
           CASE WHEN s.previous_tx IS NULL THEN 0 WHEN s.tx_bytes >= s.previous_tx THEN s.tx_bytes - s.previous_tx ELSE s.tx_bytes END AS download_delta,
           CASE WHEN s.previous_rx IS NULL THEN 0 WHEN s.rx_bytes >= s.previous_rx THEN s.rx_bytes - s.previous_rx ELSE s.rx_bytes END AS upload_delta
         FROM samples s
         WHERE s.logged_at >= ? AND s.logged_at <= ?
       )
       SELECT d.customer_id,
         COALESCE(SUM(d.download_delta), 0) AS download_bytes,
         COALESCE(SUM(d.upload_delta), 0) AS upload_bytes,
         COALESCE(SUM(d.download_delta + d.upload_delta), 0) AS total_bytes,
         COUNT(DISTINCT (d.logged_at AT TIME ZONE 'America/Sao_Paulo')::date) AS active_days,
         COALESCE(MAX(d.download_delta + d.upload_delta), 0) AS peak_bytes
       FROM deltas d GROUP BY d.customer_id`,
      [_from, _to, _from, _to]
    );
    return { rows };
  });

  // get_invoice_network_metrics(_customer_id, _from, _to)
  app.post<{ Body: { _customer_id: string; _from: string; _to: string } }>("/api/rpc/get_invoice_network_metrics", async (req) => {
    const { _customer_id, _from, _to } = req.body;
    const rows = await query<Record<string, any>[]>(
      `WITH ordered_stats AS (
         SELECT l.logged_at, l.rx_bytes, l.tx_bytes,
           lag(l.logged_at) OVER (ORDER BY l.logged_at, l.id) AS previous_at,
           lag(l.rx_bytes) OVER (ORDER BY l.logged_at, l.id) AS previous_rx,
           lag(l.tx_bytes) OVER (ORDER BY l.logged_at, l.id) AS previous_tx,
           lead(l.logged_at) OVER (ORDER BY l.logged_at, l.id) AS next_at
         FROM pppoe_logs l
         WHERE l.customer_id = ? AND l.event_type = 'stats'
           AND l.logged_at >= (?::timestamptz - INTERVAL '5 minute') AND l.logged_at <= ?
           AND l.rx_bytes IS NOT NULL AND l.tx_bytes IS NOT NULL
       ), period_stats AS (
         SELECT * FROM ordered_stats WHERE logged_at >= ? AND logged_at <= ?
       ), totals AS (
         SELECT
           COALESCE(SUM(CASE
             WHEN previous_tx IS NULL OR previous_at < (?::timestamptz - INTERVAL '2 minute') THEN 0
             WHEN tx_bytes >= previous_tx THEN tx_bytes - previous_tx ELSE tx_bytes END), 0)::bigint AS download_bytes,
           COALESCE(SUM(CASE
             WHEN previous_rx IS NULL OR previous_at < (?::timestamptz - INTERVAL '2 minute') THEN 0
             WHEN rx_bytes >= previous_rx THEN rx_bytes - previous_rx ELSE rx_bytes END), 0)::bigint AS upload_bytes,
           COALESCE(SUM(GREATEST(0, LEAST(120, EXTRACT(EPOCH FROM (LEAST(COALESCE(next_at, logged_at + INTERVAL '60 second'), ?::timestamptz) - logged_at))))), 0)::bigint AS connected_seconds,
           min(logged_at) AS observed_from,
           max(logged_at) AS observed_to
         FROM period_stats
       ), drops AS (
         SELECT count(*)::integer AS disconnect_count FROM pppoe_logs l
         WHERE l.customer_id = ? AND l.event_type = 'disconnected' AND l.logged_at >= ? AND l.logged_at <= ?
       )
       SELECT t.download_bytes, t.upload_bytes, d.disconnect_count, t.connected_seconds,
         CASE WHEN t.observed_from IS NULL OR t.observed_to IS NULL THEN 0::bigint
           ELSE GREATEST(0, EXTRACT(EPOCH FROM (t.observed_to - t.observed_from))::bigint - t.connected_seconds) END AS disconnected_seconds,
         t.observed_from, t.observed_to
       FROM totals t CROSS JOIN drops d`,
      [_customer_id, _from, _to, _from, _to, _from, _from, _to, _customer_id, _from, _to]
    );
    return { rows };
  });

  // check_and_block_overdue_customers()
  app.post("/api/rpc/check_and_block_overdue_customers", async () => {
    const blockingDays = parseInt((await getSetting("blocking_days")) || "15", 10) || 15;
    const overdue = await query<Record<string, any>[]>(
      `SELECT DISTINCT c.id FROM customers c JOIN invoices i ON i.customer_id = c.id
       WHERE i.status IN ('pending','overdue') AND i.vencimento <= (CURRENT_DATE - (? * INTERVAL '1 day')) AND c.block_status = 'active' AND c.ativo = true`,
      [blockingDays]
    );
    let blocked = 0;
    for (const c of overdue) {
      await execute("INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?,?,?,?,?)", [
        randomUUID(), c.id, "active", "blocked", `Bloqueio automático por faturas vencidas (${blockingDays} dias)`,
      ]);
      await execute("UPDATE customers SET block_status = 'blocked' WHERE id = ?", [c.id]);
      await execute("INSERT INTO block_alerts_sent (id, customer_id, new_status, processed) VALUES (?,?,?,false)", [randomUUID(), c.id, "blocked"]);
      blocked++;
    }
    const toUnblock = await query<Record<string, any>[]>(
      `SELECT c.id FROM customers c WHERE c.block_status = 'blocked' AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.status IN ('pending','overdue') AND i.vencimento <= (CURRENT_DATE - (? * INTERVAL '1 day'))
       )`,
      [blockingDays]
    );
    for (const c of toUnblock) {
      await execute("INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?,?,?,?,?)", [
        randomUUID(), c.id, "blocked", "active", "Desbloqueio automático (faturas regularizadas)",
      ]);
      await execute("UPDATE customers SET block_status = 'active' WHERE id = ?", [c.id]);
    }
    return { blocked, unblocked: toUnblock.length };
  });

  // get_recent_disconnections(since_time)
  app.post<{ Body: { since_time: string } }>("/api/rpc/get_recent_disconnections", async (req) => {
    const { since_time } = req.body;
    const rows = await query<Record<string, any>[]>(
      `SELECT ll.customer_id, ll.usuario_pppoe, c.nome, ll.last_seen
       FROM (SELECT customer_id, usuario_pppoe, MAX(logged_at) AS last_seen FROM pppoe_logs WHERE event_type = 'stats' GROUP BY customer_id, usuario_pppoe) ll
       JOIN customers c ON c.id = ll.customer_id
       WHERE NOT EXISTS (SELECT 1 FROM pppoe_logs p WHERE p.customer_id = ll.customer_id AND p.logged_at > (NOW() - INTERVAL '2 minute') AND p.event_type = 'stats')
         AND ll.last_seen < ? AND ll.last_seen > (NOW() - INTERVAL '1 hour') AND c.ativo = true`,
      [since_time]
    );
    return { rows };
  });

  // check_frequent_drops(time_threshold, drop_count)
  app.post<{ Body: { time_threshold: string; drop_count: number } }>("/api/rpc/check_frequent_drops", async (req) => {
    const { time_threshold, drop_count } = req.body;
    const rows = await query<Record<string, any>[]>(
      `SELECT l.customer_id, COUNT(DISTINCT l.uptime) AS count FROM pppoe_logs l WHERE l.logged_at > ? GROUP BY l.customer_id HAVING COUNT(DISTINCT l.uptime) >= ?`,
      [time_threshold, drop_count]
    );
    return { rows };
  });

  // check_abnormal_usage(bytes_threshold)
  app.post<{ Body: { bytes_threshold: number } }>("/api/rpc/check_abnormal_usage", async (req) => {
    const { bytes_threshold } = req.body;
    const rows = await query<Record<string, any>[]>(
      `SELECT l.customer_id, MAX(l.rx_bytes + l.tx_bytes) - MIN(l.rx_bytes + l.tx_bytes) AS total_bytes
       FROM pppoe_logs l WHERE l.logged_at > (NOW() - INTERVAL '20 minute')
       GROUP BY l.customer_id HAVING (MAX(l.rx_bytes + l.tx_bytes) - MIN(l.rx_bytes + l.tx_bytes)) > ?`,
      [bytes_threshold]
    );
    return { rows };
  });

  app.post<{ Body: { _user_id: string } }>("/api/rpc/has_role", async (req) => {
    const { _user_id } = req.body;
    const rows = await query("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", [_user_id]);
    return (rows as any[]).length > 0;
  });
}
