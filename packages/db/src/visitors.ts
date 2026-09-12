import type { Database } from "bun:sqlite";
import type { VisitorRow } from "./schema.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function nid(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 22);
}

export function newVisitorId(): string {
  return nid("vis_");
}

export function newVisitorShortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  let body = "";
  for (let i = 0; i < 5; i++) {
    body = CROCKFORD[n & 31] + body;
    n >>>= 5;
  }
  return `G-${body}`;
}

export class VisitorRepo {
  constructor(private readonly sqlite: Database) {}

  insert(row: VisitorRow): void {
    this.sqlite
      .query(
        `INSERT INTO visitors (
          id, short_id, fingerprint, key_hash, key_prefix, key_plain,
          ip, user_agent, last_client, last_protocol, last_seen_at, created_at, last_key_prefix
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.short_id,
        row.fingerprint,
        row.key_hash,
        row.key_prefix,
        row.key_plain,
        row.ip,
        row.user_agent,
        row.last_client,
        row.last_protocol,
        row.last_seen_at,
        row.created_at,
        row.last_key_prefix ?? null,
      );
  }

  getById(id: string): VisitorRow | null {
    return (this.sqlite.query("SELECT * FROM visitors WHERE id = ?").get(id) as VisitorRow | null) ?? null;
  }

  getByKeyHash(keyHash: string): VisitorRow | null {
    return (
      (this.sqlite.query("SELECT * FROM visitors WHERE key_hash = ?").get(keyHash) as VisitorRow | null) ?? null
    );
  }

  getByShortId(shortId: string): VisitorRow | null {
    return (
      (this.sqlite.query("SELECT * FROM visitors WHERE short_id = ?").get(shortId) as VisitorRow | null) ?? null
    );
  }

  getByFingerprint(fingerprint: string): VisitorRow | null {
    return (
      (this.sqlite
        .query("SELECT * FROM visitors WHERE fingerprint = ? ORDER BY last_seen_at DESC LIMIT 1")
        .get(fingerprint) as VisitorRow | null) ?? null
    );
  }

  getMany(ids: string[]): VisitorRow[] {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const ph = unique.map(() => "?").join(",");
    return this.sqlite.query(`SELECT * FROM visitors WHERE id IN (${ph})`).all(...unique) as VisitorRow[];
  }

  listRecent(since: number, limit = 50): VisitorRow[] {
    return this.sqlite
      .query("SELECT * FROM visitors WHERE last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT ?")
      .all(since, limit) as VisitorRow[];
  }

  touch(
    id: string,
    patch: {
      last_seen_at: number;
      ip?: string;
      user_agent?: string;
      last_client?: string;
      last_protocol?: string;
      last_key_prefix?: string;
    },
  ): void {
    const row = this.getById(id);
    if (!row) return;
    this.sqlite
      .query(
        `UPDATE visitors SET last_seen_at = ?, ip = ?, user_agent = ?, last_client = ?, last_protocol = ?, last_key_prefix = ?
         WHERE id = ?`,
      )
      .run(
        patch.last_seen_at,
        patch.ip ?? row.ip,
        patch.user_agent ?? row.user_agent,
        patch.last_client ?? row.last_client,
        patch.last_protocol ?? row.last_protocol,
        patch.last_key_prefix ?? row.last_key_prefix,
        id,
      );
  }

  setKey(id: string, key: { key_hash: string; key_prefix: string; key_plain: string }): void {
    this.sqlite
      .query("UPDATE visitors SET key_hash = ?, key_prefix = ?, key_plain = ? WHERE id = ?")
      .run(key.key_hash, key.key_prefix, key.key_plain, id);
  }
}
