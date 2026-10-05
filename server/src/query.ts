import { isValidColumn } from "./schema.js";

export type Filter =
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; column: string; value: unknown }
  | { op: "in"; column: string; values: unknown[] }
  | { op: "is"; column: string; value: unknown }
  | { op: "not"; column: string; subop: "eq" | "is" | "in"; value: unknown }
  | { op: "like" | "ilike"; column: string; value: string }
  | { op: "or"; filters: Filter[] };

export interface OrderClause {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

interface SelectRequest {
  table: string;
  columns?: string[]; // ["*"] or ["id","nome"]
  filters?: Filter[];
  order?: OrderClause[];
  limit?: number;
  offset?: number;
}

const OPS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

// Coerce value for a comparison (Postgres aceita booleanos nativamente)
function norm(value: unknown): unknown {
  return value;
}

export function buildWhere(
  table: string,
  filters: Filter[],
  params: unknown[] = []
): string {
  if (!filters.length) return "";
  const clauses = filters.map((f) => buildFilter(table, f, params));
  return clauses.join(" AND ");
}

function buildFilter(table: string, f: Filter, params: unknown[]): string {
  switch (f.op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      assertColumn(table, f.column);
      params.push(norm(f.value));
      return `\`${f.column}\` ${OPS[f.op]} ?`;
    }
    case "in": {
      assertColumn(table, f.column);
      if (!f.values.length) return "1=0";
      params.push(...f.values.map(norm));
      const marks = f.values.map(() => "?").join(",");
      return `\`${f.column}\` IN (${marks})`;
    }
    case "is": {
      assertColumn(table, f.column);
      if (f.value === null || f.value === undefined) return `\`${f.column}\` IS NULL`;
      if (f.value === true) return `\`${f.column}\` IS TRUE`;
      if (f.value === false) return `\`${f.column}\` IS FALSE`;
      params.push(norm(f.value));
      return `\`${f.column}\` = ?`;
    }
    case "not": {
      assertColumn(table, f.column);
      if (f.subop === "is") {
        if (f.value === null || f.value === undefined) return `\`${f.column}\` IS NOT NULL`;
        if (f.value === true) return `\`${f.column}\` IS NOT TRUE`;
        if (f.value === false) return `\`${f.column}\` IS NOT FALSE`;
      }
      if (f.subop === "in" && Array.isArray(f.value)) {
        if (!f.value.length) return "1=1";
        params.push(...f.value.map(norm));
        const marks = f.value.map(() => "?").join(",");
        return `\`${f.column}\` NOT IN (${marks})`;
      }
      params.push(norm(f.value));
      return `\`${f.column}\` <> ?`;
    }
    case "like":
    case "ilike": {
      assertColumn(table, f.column);
      const pattern = toLikePattern(f.value ?? "");
      params.push(pattern);
      return `\`${f.column}\` LIKE ?`;
    }
    case "or": {
      if (!f.filters.length) return "1=1";
      const inner = f.filters.map((sub) => buildFilter(table, sub, params));
      return `(${inner.join(" OR ")})`;
    }
    default:
      return "1=1";
  }
}

// PostgREST ilike: '*' ou '%' são wildcards. Se não houver wildcard, envolve com %...%
function toLikePattern(value: string): string {
  let v = value.replace(/\*/g, "%");
  if (!v.includes("%")) v = `%${v}%`;
  return v;
}

function assertColumn(table: string, column: string) {
  if (!isValidColumn(table, column)) {
    throw new Error(`Coluna inválida: ${table}.${column}`);
  }
}

export function buildSelectColumns(table: string, columns?: string[]): string {
  if (!columns || columns.length === 0 || columns.includes("*")) {
    return `\`${table}\`.*`;
  }
  const cols = columns.filter((c) => isValidColumn(table, c)).map((c) => `\`${c}\``);
  return cols.length ? cols.join(", ") : `\`${table}\`.*`;
}

export function buildOrderBy(table: string, order?: OrderClause[]): string {
  if (!order || !order.length) return "";
  const parts = order
    .filter((o) => isValidColumn(table, o.column))
    .map((o) => {
      const dir = o.ascending ? "ASC" : "DESC";
      const nulls = o.nullsFirst ? " NULLS FIRST" : "";
      return `\`${o.column}\` ${dir}${nulls}`;
    });
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

export function buildLimitOffset(limit?: number, offset?: number): string {
  let sql = "";
  if (typeof limit === "number" && limit >= 0) sql += ` LIMIT ${Math.floor(limit)}`;
  if (typeof offset === "number" && offset >= 0) sql += ` OFFSET ${Math.floor(offset)}`;
  return sql;
}

export function buildSelect(req: SelectRequest): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where = buildWhere(req.table, req.filters ?? [], params);
  const sql =
    `SELECT ${buildSelectColumns(req.table, req.columns)} ` +
    `FROM \`${req.table}\`` +
    (where ? ` WHERE ${where}` : "") +
    buildOrderBy(req.table, req.order) +
    buildLimitOffset(req.limit, req.offset);
  return { sql, params };
}
