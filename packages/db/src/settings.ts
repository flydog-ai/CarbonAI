import type { Database } from "bun:sqlite";

export class SettingsRepo {
  constructor(private readonly sqlite: Database) {}

  getAll(): Record<string, string> {
    const rows = this.sqlite.query("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  get(key: string): string | undefined {
    const row = this.sqlite.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.sqlite.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}
