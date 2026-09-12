import type { Database } from "bun:sqlite";
import type { ChannelAccountRow, ChannelBindingRow } from "./schema.ts";

function nid(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 22);
}

export function newChannelId(): string {
  return nid("ch_");
}

export function newBindingId(): string {
  return nid("bnd_");
}

export class ChannelRepo {
  constructor(private readonly sqlite: Database) {}

  getByKind(kind: string): ChannelAccountRow | null {
    return (
      (this.sqlite.query("SELECT * FROM channel_accounts WHERE kind = ?").get(kind) as ChannelAccountRow | null) ??
      null
    );
  }

  getById(id: string): ChannelAccountRow | null {
    return (
      (this.sqlite.query("SELECT * FROM channel_accounts WHERE id = ?").get(id) as ChannelAccountRow | null) ?? null
    );
  }

  upsertByKind(row: ChannelAccountRow): void {
    const existing = this.getByKind(row.kind);
    if (existing) {
      this.sqlite
        .query(
          `UPDATE channel_accounts
           SET label = ?, app_id = ?, app_secret = ?, token = ?, aes_key = ?, enabled = ?
           WHERE id = ?`,
        )
        .run(row.label, row.app_id, row.app_secret, row.token, row.aes_key, row.enabled, existing.id);
      return;
    }
    this.sqlite
      .query(
        `INSERT INTO channel_accounts (id, kind, label, app_id, app_secret, token, aes_key, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.kind,
        row.label,
        row.app_id,
        row.app_secret,
        row.token,
        row.aes_key,
        row.enabled,
        row.created_at,
      );
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
}
