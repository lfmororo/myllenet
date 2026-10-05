import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query, execute } from "../db.js";
import { isValidTable, isValidColumn, tableRelations, tableColumns, type Relation } from "../schema.js";
import { buildSelect, type Filter, type OrderClause } from "../query.js";

interface SelectBody {
  table: string;
  columns?: string[];
  embed?: Record<string, string[] | "*">;
  filters?: Filter[];
  order?: OrderClause[];
  limit?: number;
  offset?: number;
  count?: boolean;
}

interface InsertBody {
  table: string;
  rows: Record<string, unknown> | Record<string, unknown>[];
  returning?: string[];
}

interface UpdateBody {
  table: string;
  values: Record<string, unknown>;
  filters: Filter[];
  returning?: string[];
}

interface DeleteBody {
  table: string;
  filters: Filter[];
  returning?: string[];
}

function serializeRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  return row;
}

function coerceValue(table: string, column: string, value: unknown): unknown {
  return value;
}

function buildInsert(table: string, row: Record<string, unknown>): { sql: string; params: unknown[]; id: string } {
  const cols = tableColumns(table) ?? [];
  const data: Record<string, unknown> = { ...row };
  if (!data.id) data.id = randomUUID();
  const keys = Object.keys(data).filter((k) => cols.includes(k));
  const params = keys.map((k) => coerceValue(table, k, data[k]));
  const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  return { sql, params, id: data.id as string };
}

function buildUpdate(table: string, values: Record<string, unknown>, filters: Filter[]): { sql: string; params: unknown[] } {
  const cols = tableColumns(table) ?? [];
  const keys = Object.keys(values).filter((k) => cols.includes(k));
  if (!keys.length) throw new Error("Nenhuma coluna válida para atualizar");
  const params: unknown[] = [];
  const sets = keys.map((k) => {
    params.push(coerceValue(table, k, values[k]));
    return `\`${k}\` = ?`;
  });
  const whereParams: unknown[] = [];
  const where = buildWhereForUpdate(table, filters, whereParams);
  params.push(...whereParams);
  const sql = `UPDATE \`${table}\` SET ${sets.join(", ")}${where ? ` WHERE ${where}` : ""}`;
  return { sql, params };
}

import { buildWhere } from "../query.js";
function buildWhereForUpdate(table: string, filters: Filter[], params: unknown[]): string {
  return buildWhere(table, filters, params);
}

async function fetchEmbedded(rows: Record<string, unknown>[], table: string, embed: Record<string, string[] | "*">) {
  for (const [alias, cols] of Object.entries(embed)) {
    const rel: Relation | undefined = tableRelations(table).find((r) => r.alias === alias);
    if (!rel) continue;
    const ids = rows
      .map((r) => r[rel.fkColumn])
      .filter((v) => v !== null && v !== undefined);
    if (!ids.length) {
      for (const r of rows) r[alias] = null;
      continue;
    }
    const unique = [...new Set(ids)];
    const marks = unique.map(() => "?").join(",");
    const refCols = tableColumns(rel.refTable) ?? [];
    const selectCols =
      cols === "*" ? `\`${rel.refTable}\`.*` :
      cols.filter((c) => refCols.includes(c)).map((c) => `\`${rel.refTable}\`.\`${c}\``).join(", ");
    const related = await query<Record<string, unknown>[]>(
      `SELECT ${selectCols} FROM \`${rel.refTable}\` WHERE \`${rel.refColumn}\` IN (${marks})`,
      unique
    );
    const map = new Map();
    for (const r of related) map.set(r[rel.refColumn], serializeRow(rel.refTable, r));
    for (const row of rows) {
      row[alias] = map.get(row[rel.fkColumn]) ?? null;
    }
  }
}

async function runSelect(body: SelectBody) {
  if (!isValidTable(body.table)) throw Object.assign(new Error("Tabela inválida"), { statusCode: 400 });

  let { sql, params } = buildSelect({
    table: body.table,
    columns: body.columns,
    filters: body.filters,
    order: body.order,
    limit: body.limit,
    offset: body.offset,
  });

  let total: number | undefined;
  if (body.count) {
    const where = buildWhere(body.table, body.filters ?? [], []);
    const countSql = `SELECT COUNT(*) AS c FROM \`${body.table}\`${where ? ` WHERE ${where}` : ""}`;
    // re-run with params to be safe
    const whereParams: unknown[] = [];
    buildWhere(body.table, body.filters ?? [], whereParams);
    const cnt = await query<{ c: number }[]>(`SELECT COUNT(*) AS c FROM \`${body.table}\`${where ? ` WHERE ${where}` : ""}`, whereParams);
    total = Number(cnt[0]?.c ?? 0);
  }

  const rows = await query<Record<string, unknown>[]>(sql, params);
  const data = rows.map((r) => serializeRow(body.table, r));

  if (body.embed) {
    await fetchEmbedded(data, body.table, body.embed);
  }

  return body.count ? { rows: data, count: total } : { rows: data };
}

// Side effects que eram triggers no Postgres
async function customerUpdateEffects(table: string, values: Record<string, unknown>, filters: Filter[]) {
  if (table !== "customers") return;
  const touched = Object.keys(values);
  const blockChange = touched.includes("block_status") || touched.includes("ativo");

  // Capturar mudança de status para enfileirar comandos no Mikrotik
  if (blockChange) {
    const whereParams: unknown[] = [];
    const where = buildWhere(table, filters, whereParams);
    const rows = await query<Record<string, unknown>[]>(
      `SELECT id, nome, usuario_pppoe, senha_pppoe, ativo, block_status FROM \`customers\` WHERE ${where}`,
      whereParams
    );
    for (const c of rows) {
      const newAtivo = values.ativo !== undefined ? !!values.ativo : !!c.ativo;
      const newBlock = (values.block_status as string) ?? c.block_status;
      const oldBlock = c.block_status;
      const oldAtivo = !!c.ativo;

      const shouldBlock = newBlock === "blocked" || !newAtivo;
      const wasBlocked = oldBlock === "blocked" || !oldAtivo;

      // queue mikrotik command on transition
      if (c.usuario_pppoe && shouldBlock !== wasBlocked) {
        let action = shouldBlock ? "disable" : "enable";
        // deactivation -> remove
        if (!newAtivo && oldAtivo) action = "remove";
        await execute(
          "INSERT INTO mikrotik_commands (id, customer_id, usuario_pppoe, action, payload) VALUES (?, ?, ?, ?, ?)",
          [randomUUID(), c.id, c.usuario_pppoe, action, JSON.stringify({ password: c.senha_pppoe, nome: c.nome })]
        );
      }

      // queue block alert
      if (touched.includes("block_status") && newBlock !== oldBlock && (newBlock === "active" || newBlock === "blocked")) {
        await execute(
          "INSERT INTO block_alerts_sent (id, customer_id, new_status, processed) VALUES (?, ?, ?, false)",
          [randomUUID(), c.id, newBlock]
        );
        await execute(
          "INSERT INTO block_history (id, customer_id, old_status, new_status, reason) VALUES (?, ?, ?, ?, ?)",
          [randomUUID(), c.id, oldBlock, newBlock, "Alteração manual de status"]
        );
      }

      // activation change alert
      if (touched.includes("ativo") && newAtivo !== oldAtivo) {
        await execute(
          "INSERT INTO block_alerts_sent (id, customer_id, new_status, processed) VALUES (?, ?, ?, false)",
          [randomUUID(), c.id, newAtivo ? "reactivated" : "deactivated"]
        );
        // capture cancellation
        if (!newAtivo) {
          await execute("UPDATE customers SET cancelled_at = COALESCE(cancelled_at, NOW()) WHERE id = ?", [c.id]);
        } else {
          await execute("UPDATE customers SET cancelled_at = NULL, cancel_reason = NULL WHERE id = ?", [c.id]);
        }
      }
    }
  }
}

async function customerDeleteEffects(table: string, filters: Filter[]) {
  if (table !== "customers") return;
  const whereParams: unknown[] = [];
  const where = buildWhere(table, filters, whereParams);
  const rows = await query<Record<string, unknown>[]>(
    `SELECT id, nome, usuario_pppoe FROM \`customers\` WHERE ${where}`,
    whereParams
  );
  for (const c of rows) {
    if (c.usuario_pppoe) {
      await execute(
        "INSERT INTO mikrotik_commands (id, usuario_pppoe, action, payload) VALUES (?, ?, 'remove', ?)",
        [randomUUID(), c.usuario_pppoe, JSON.stringify({ nome: c.nome, motivo: "cliente excluido" })]
      );
    }
  }
}

export async function registerRestRoutes(app: FastifyInstance) {
  app.post<{ Body: SelectBody }>("/api/rest/select", async (req, reply) => {
    try {
      return await runSelect(req.body);
    } catch (e: any) {
      return reply.code(e.statusCode || 500).send({ error: e.message || "Erro interno" });
    }
  });

  app.post<{ Body: InsertBody }>("/api/rest/insert", async (req, reply) => {
    const { table, rows } = req.body;
    if (!isValidTable(table)) return reply.code(400).send({ error: "Tabela inválida" });
    const arr = Array.isArray(rows) ? rows : [rows];
    const inserted: Record<string, unknown>[] = [];
    for (const r of arr) {
      const { sql, params, id } = buildInsert(table, r);
      await execute(sql, params);
      const fresh = await query<Record<string, unknown>[]>(
        `SELECT * FROM \`${table}\` WHERE id = ?`,
        [id]
      );
      if (fresh[0]) inserted.push(serializeRow(table, fresh[0]));
    }
    return { rows: inserted };
  });

  app.post<{ Body: UpdateBody }>("/api/rest/update", async (req, reply) => {
    const { table, values, filters } = req.body;
    if (!isValidTable(table)) return reply.code(400).send({ error: "Tabela inválida" });
    const { sql, params } = buildUpdate(table, values, filters);
    await customerUpdateEffects(table, values, filters);
    const result = await execute(sql, params);
    return { affected: result.affectedRows };
  });

  app.post<{ Body: DeleteBody }>("/api/rest/delete", async (req, reply) => {
    const { table, filters } = req.body;
    if (!isValidTable(table)) return reply.code(400).send({ error: "Tabela inválida" });
    await customerDeleteEffects(table, filters);
    const whereParams: unknown[] = [];
    const where = buildWhere(table, filters, whereParams);
    const result = await execute(`DELETE FROM \`${table}\`${where ? ` WHERE ${where}` : ""}`, whereParams);
    return { affected: result.affectedRows };
  });
}
