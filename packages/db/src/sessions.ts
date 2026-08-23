import type { Database } from "bun:sqlite";
import type { SessionRow } from "./schema.ts";

export class SessionRepo {
  constructor(private readonly sqlite: Database) {}

  insert(row: SessionRow): void {
    this.sqlite
      .query(
        `INSERT INTO sessions (id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(row.id, row.user_id, row.created_at, row.expires_at);
  }

  get(id: string): SessionRow | null {
    return (this.sqlite.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null) ?? null;
  }

  delete(id: string): void {
    this.sqlite.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteByUser(userId: string): number {
    return Number(this.sqlite.query("DELETE FROM sessions WHERE user_id = ?").run(userId).changes);
  }

  deleteExpired(now = Date.now()): number {
    return Number(this.sqlite.query("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes);
  }
}
