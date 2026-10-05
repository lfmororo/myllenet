import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "../db.js";

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const marks = keys.map(() => "?").join(",");
  const rows = await query<{ key: string; value: string | null }[]>(
    `SELECT \`key\`, value FROM settings WHERE \`key\` IN (${marks})`,
    keys
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value ?? "";
  return map;
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>("SELECT value FROM settings WHERE `key` = ?", [key]);
  return row ? row.value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const existing = await queryOne<{ id: string }>("SELECT id FROM settings WHERE `key` = ?", [key]);
  if (existing) {
    await execute("UPDATE settings SET value = ? WHERE `key` = ?", [value, key]);
  } else {
    await execute("INSERT INTO settings (id, `key`, value) VALUES (?, ?, ?)", [randomUUID(), key, value]);
  }
}

export async function setSettings(values: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(values)) await setSetting(k, v);
}
