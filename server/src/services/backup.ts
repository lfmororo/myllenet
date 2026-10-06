import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { query } from "../db.js";

export const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(process.cwd(), "backups");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function tableToCsv(table: string): Promise<{ csv: string; rows: number }> {
  const cols = await query<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position",
    [table]
  );
  const names = cols.map((c) => c.column_name);
  const lines = [names.map(csvValue).join(",")];
  const batch = 5000;
  let offset = 0;
  let total = 0;
  const order = names.includes("id") ? `ORDER BY "id"` : "";
  for (;;) {
    const rows = await query<Record<string, unknown>[]>(
      `SELECT * FROM "${table.replace(/"/g, "")}" ${order} LIMIT ${batch} OFFSET ${offset}`
    );
    for (const r of rows) lines.push(names.map((n) => csvValue(r[n])).join(","));
    total += rows.length;
    if (rows.length < batch) break;
    offset += batch;
  }
  return { csv: "\uFEFF" + lines.join("\r\n"), rows: total };
}

export async function createBackup(origin: "manual" | "automatico") {
  await mkdir(BACKUP_DIR, { recursive: true });
  const tables = await query<{ table_name: string }[]>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const files: Record<string, Uint8Array> = {};
  const summary: { tabela: string; registros: number }[] = [];
  for (const { table_name } of tables) {
    const { csv, rows } = await tableToCsv(table_name);
    files[`${table_name}.csv`] = strToU8(csv);
    summary.push({ tabela: table_name, registros: rows });
  }
  const now = new Date();
  files["_info.json"] = strToU8(JSON.stringify({ gerado_em: now.toISOString(), origem: origin, tabelas: summary }, null, 2));
  const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = `backup-${stamp}-${origin}.zip`;
  await writeFile(path.join(BACKUP_DIR, file), zipSync(files, { level: 6 }));
  await pruneBackups();
  return { file, tables: summary.length, rows: summary.reduce((a, b) => a + b.registros, 0) };
}

export async function listBackups() {
  await mkdir(BACKUP_DIR, { recursive: true });
  const names = (await readdir(BACKUP_DIR)).filter((f) => /^backup-.*\.zip$/.test(f));
  const out = await Promise.all(
    names.map(async (name) => {
      const s = await stat(path.join(BACKUP_DIR, name));
      return { file: name, size: s.size, created_at: s.mtime.toISOString() };
    })
  );
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function pruneBackups() {
  const limit = Date.now() - KEEP_DAYS * 86400000;
  for (const b of await listBackups()) {
    if (new Date(b.created_at).getTime() < limit) await unlink(path.join(BACKUP_DIR, b.file)).catch(() => {});
  }
}

export function safeBackupPath(file: string): string | null {
  if (!/^backup-[\w-]+\.zip$/.test(file)) return null;
  return path.join(BACKUP_DIR, file);
}
