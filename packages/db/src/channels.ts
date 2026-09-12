import type { Database } from "bun:sqlite";
import type { ChannelAccountRow, ChannelBindingRow, ChannelEventRow } from "./schema.ts";

function nid(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 22);
}

export function newChannelId(): string {
  return nid("ch_");
}

export function newBindingId(): string {
  return nid("bnd_");
}

export function newChannelEventId(): string {
  return nid("cev_");
}

export class ChannelRepo {
  constructor(private readonly sqlite: Database) {}

  getById(id: string): ChannelAccountRow | null {
    return (
      (this.sqlite.query("SELECT * FROM channel_accounts WHERE id = ?").get(id) as ChannelAccountRow | null) ?? null
    );
  }

  getByUserKind(userId: string, kind: string): ChannelAccountRow | null {
    return (
      (this.sqlite
        .query("SELECT * FROM channel_accounts WHERE user_id = ? AND kind = ?")
        .get(userId, kind) as ChannelAccountRow | null) ?? null
    );
  }

  listByKind(kind: string): ChannelAccountRow[] {
    return this.sqlite
      .query("SELECT * FROM channel_accounts WHERE kind = ? ORDER BY created_at ASC")
      .all(kind) as ChannelAccountRow[];
  }

  listEnabled(kind: string): ChannelAccountRow[] {
    return this.sqlite
      .query("SELECT * FROM channel_accounts WHERE kind = ? AND enabled = 1 ORDER BY created_at ASC")
      .all(kind) as ChannelAccountRow[];
  }

  listByUser(userId: string): ChannelAccountRow[] {
    return this.sqlite
      .query("SELECT * FROM channel_accounts WHERE user_id = ? ORDER BY created_at ASC")
      .all(userId) as ChannelAccountRow[];
  }

  upsertByKind(row: ChannelAccountRow): void {
    if (!row.user_id) throw new Error("channel account requires user_id");
    const existing = this.getByUserKind(row.user_id, row.kind);
    if (existing) {
      this.sqlite
        .query(
          `UPDATE channel_accounts
           SET label = ?, app_id = ?, app_secret = ?, token = ?, aes_key = ?, enabled = ?,
               base_url = ?, sync_buf = ?
           WHERE id = ?`,
        )
        .run(
          row.label,
          row.app_id,
          row.app_secret,
          row.token,
          row.aes_key,
          row.enabled,
          row.base_url ?? existing.base_url,
          row.sync_buf ?? existing.sync_buf,
          existing.id,
        );
      return;
    }
    this.sqlite
      .query(
        `INSERT INTO channel_accounts (id, user_id, kind, label, app_id, app_secret, token, aes_key, enabled, created_at, base_url, sync_buf)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.user_id,
        row.kind,
        row.label,
        row.app_id,
        row.app_secret,
        row.token,
        row.aes_key,
        row.enabled,
        row.created_at,
        row.base_url ?? null,
        row.sync_buf ?? null,
      );
  }

  setSyncBuf(id: string, buf: string): void {
    this.sqlite.query("UPDATE channel_accounts SET sync_buf = ? WHERE id = ?").run(buf, id);
  }

  listBindings(accountId: string): ChannelBindingRow[] {
    return this.sqlite
      .query("SELECT * FROM channel_bindings WHERE account_id = ? ORDER BY created_at ASC")
      .all(accountId) as ChannelBindingRow[];
  }

  getBindingByPeer(accountId: string, peerId: string): ChannelBindingRow | null {
    return (
      (this.sqlite
        .query("SELECT * FROM channel_bindings WHERE account_id = ? AND peer_id = ?")
        .get(accountId, peerId) as ChannelBindingRow | null) ?? null
    );
  }

  getBindingByUser(accountId: string, userId: string): ChannelBindingRow | null {
    return (
      (this.sqlite
        .query("SELECT * FROM channel_bindings WHERE account_id = ? AND user_id = ?")
        .get(accountId, userId) as ChannelBindingRow | null) ?? null
    );
  }

  insertBinding(row: ChannelBindingRow): void {
    const byPeer = this.getBindingByPeer(row.account_id, row.peer_id);
    if (byPeer) this.sqlite.query("DELETE FROM channel_bindings WHERE id = ?").run(byPeer.id);
    const byUser = this.getBindingByUser(row.account_id, row.user_id);
    if (byUser) this.sqlite.query("DELETE FROM channel_bindings WHERE id = ?").run(byUser.id);
    this.sqlite
      .query(
        `INSERT INTO channel_bindings (id, account_id, user_id, peer_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.account_id, row.user_id, row.peer_id, row.created_at);
  }

  deleteBindingByUser(accountId: string, userId: string): void {
    this.sqlite.query("DELETE FROM channel_bindings WHERE account_id = ? AND user_id = ?").run(accountId, userId);
  }

  addEvent(row: ChannelEventRow): void {
    this.sqlite
      .query(
        `INSERT INTO channel_events (id, account_id, kind, level, event, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.account_id, row.kind, row.level, row.event, row.detail, row.created_at);
    this.sqlite
      .query(
        `DELETE FROM channel_events WHERE account_id = ? AND id NOT IN (
           SELECT id FROM channel_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 80
         )`,
      )
      .run(row.account_id, row.account_id);
  }

  listEvents(kind: string, limit = 30): ChannelEventRow[] {
    return this.sqlite
      .query("SELECT * FROM channel_events WHERE kind = ? ORDER BY created_at DESC LIMIT ?")
      .all(kind, limit) as ChannelEventRow[];
  }

  listEventsForUser(userId: string, kind: string, limit = 30): ChannelEventRow[] {
    const account = this.getByUserKind(userId, kind);
    if (!account) return [];
    return this.sqlite
      .query("SELECT * FROM channel_events WHERE account_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(account.id, limit) as ChannelEventRow[];
  }
}
