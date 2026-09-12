import type { Database } from "bun:sqlite";
import type { ApiKeyRow, UserRole, UserRow } from "./schema.ts";

function nid(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 22);
}

export class UserRepo {
  constructor(private readonly sqlite: Database) {}

  count(): number {
    const row = this.sqlite.query("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return row.n;
  }

  insert(row: UserRow): void {
    this.sqlite
      .query(
        `INSERT INTO users (id, username, password_hash, role, can_reply, disabled, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.username,
        row.password_hash,
        row.role,
        row.can_reply,
        row.disabled,
        row.created_at,
        row.last_seen_at ?? null,
      );
  }

  getById(id: string): UserRow | null {
    return (this.sqlite.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null) ?? null;
  }

  getByUsername(username: string): UserRow | null {
    return (this.sqlite.query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null) ?? null;
  }

  list(): UserRow[] {
    return this.sqlite.query("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
  }

  setPasswordHash(id: string, passwordHash: string): void {
    this.sqlite.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  updateFlags(id: string, patch: { can_reply?: boolean; disabled?: boolean; role?: UserRole }): void {
    const current = this.getById(id);
    if (!current) return;
    const canReply = patch.can_reply === undefined ? current.can_reply : patch.can_reply ? 1 : 0;
    const disabled = patch.disabled === undefined ? current.disabled : patch.disabled ? 1 : 0;
    const role = patch.role ?? current.role;
    this.sqlite.query("UPDATE users SET can_reply = ?, disabled = ?, role = ? WHERE id = ?").run(canReply, disabled, role, id);
  }

  insertKey(row: ApiKeyRow): void {
    this.sqlite
      .query(
        `INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, key_plain, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.user_id, row.label, row.key_hash, row.key_prefix, row.key_plain, row.created_at, row.revoked_at);
  }

  getKeyByHash(keyHash: string): ApiKeyRow | null {
    return (this.sqlite.query("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as ApiKeyRow | null) ?? null;
  }

  listKeys(userId: string): ApiKeyRow[] {
    return this.sqlite
      .query("SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
      .all(userId) as ApiKeyRow[];
  }

  getKey(id: string): ApiKeyRow | null {
    return (this.sqlite.query("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | null) ?? null;
  }

  revokeKey(id: string, at: number): void {
    this.sqlite.query("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, id);
  }

  deleteKey(id: string): void {
    this.sqlite.query("DELETE FROM api_keys WHERE id = ?").run(id);
  }

  touchLastSeen(id: string, at: number): void {
    this.sqlite.query("UPDATE users SET last_seen_at = ? WHERE id = ?").run(at, id);
  }

  listSeenSince(since: number, limit = 50): UserRow[] {
    return this.sqlite
      .query(
        "SELECT * FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT ?",
      )
      .all(since, limit) as UserRow[];
  }
}

export async function newUser(opts: {
  username: string;
  password: string;
  role?: UserRole;
  canReply?: boolean;
}): Promise<UserRow> {
  return {
    id: nid("usr_"),
    username: opts.username,
    password_hash: await Bun.password.hash(opts.password),
    role: opts.role ?? "user",
    can_reply: opts.canReply ? 1 : 0,
    disabled: 0,
    created_at: Date.now(),
    last_seen_at: null,
  };
}

export function newApiKeyId(): string {
  return nid("key_");
}
