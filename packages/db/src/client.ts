import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_SQL, type BlobRow, type JobRow } from "./schema.ts";
import { UserRepo } from "./users.ts";

const RAW_INLINE_LIMIT = 1024 * 1024;

export class CarbonDb {
  readonly path: string;
  readonly dataDir: string;
  readonly blobDir: string;
  readonly users: UserRepo;

  constructor(
    readonly sqlite: Database,
    dataDir: string,
  ) {
    this.dataDir = dataDir;
    this.path = join(dataDir, "carbon.db");
    this.blobDir = join(dataDir, "blobs");
    this.users = new UserRepo(sqlite);
    mkdirSync(this.blobDir, { recursive: true, mode: 0o700 });
  }

  close(): void {
    this.sqlite.close();
  }

  insertJob(row: JobRow): void {
    this.sqlite
      .query(
        `INSERT INTO jobs (
          id, status, protocol, vendor_id, model, client_key_id, client_label, stream,
          request_hash, request_path, request_json, headers_json, normalized_json,
          response_json, events_json, claimed_by, claimed_at, error_json,
          input_tokens, output_tokens, created_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.status,
        row.protocol,
        row.vendor_id,
        row.model,
        row.client_key_id,
        row.client_label,
        row.stream,
        row.request_hash,
        row.request_path,
        row.request_json,
        row.headers_json,
        row.normalized_json,
        row.response_json,
        row.events_json,
        row.claimed_by,
        row.claimed_at,
        row.error_json,
        row.input_tokens,
        row.output_tokens,
        row.created_at,
        row.started_at,
        row.finished_at,
      );
  }

  getJob(id: string): JobRow | null {
    return (this.sqlite.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null) ?? null;
  }

  updateJob(id: string, patch: Partial<JobRow>): void {
    const keys = (Object.keys(patch) as (keyof JobRow)[]).filter((k) => patch[k] !== undefined);
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => patch[k] ?? null);
    this.sqlite.query(`UPDATE jobs SET ${sets} WHERE id = ?`).run(...values, id);
  }

  countByStatus(statuses: string[]): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => "?").join(",");
    const row = this.sqlite
      .query(`SELECT COUNT(*) AS n FROM jobs WHERE status IN (${placeholders})`)
      .get(...statuses) as { n: number };
    return row.n;
  }

  findByHash(hash: string, excludeId?: string): JobRow | null {
    if (excludeId) {
      return (
        (this.sqlite
          .query(
            "SELECT * FROM jobs WHERE request_hash = ? AND id != ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(hash, excludeId) as JobRow | null) ?? null
      );
    }
    return (
      (this.sqlite
        .query("SELECT * FROM jobs WHERE request_hash = ? ORDER BY created_at DESC LIMIT 1")
        .get(hash) as JobRow | null) ?? null
    );
  }

  listRecent(limit = 50): JobRow[] {
    return this.sqlite.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[];
  }

  failInFlight(now = Date.now()): number {
    const result = this.sqlite
      .query(
        `UPDATE jobs SET status = 'failed', error_json = ?, finished_at = ?
         WHERE status IN ('pending', 'claimed', 'streaming')`,
      )
      .run(JSON.stringify({ code: "gateway_restart", message: "Carbon AI restarted" }), now);
    return Number(result.changes);
  }

  deleteOlderThan(cutoffMs: number): number {
    const result = this.sqlite.query("DELETE FROM jobs WHERE created_at < ?").run(cutoffMs);
    return Number(result.changes);
  }

  allJobsNormalized(): { id: string; normalized_json: string }[] {
    return this.sqlite.query("SELECT id, normalized_json FROM jobs").all() as {
      id: string;
      normalized_json: string;
    }[];
  }

  insertBlob(row: BlobRow): void {
    this.sqlite
      .query(
        `INSERT OR IGNORE INTO blobs (sha256, media_type, byte_len, path)
         VALUES (?, ?, ?, ?)`,
      )
      .run(row.sha256, row.media_type, row.byte_len, row.path);
  }

  listBlobs(): BlobRow[] {
    return this.sqlite.query("SELECT * FROM blobs").all() as BlobRow[];
  }

  deleteBlob(sha256: string): void {
    this.sqlite.query("DELETE FROM blobs WHERE sha256 = ?").run(sha256);
  }
}

export function openDatabase(dataDir: string): CarbonDb {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "carbon.db");
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA locking_mode = EXCLUSIVE;");
  sqlite.exec("BEGIN EXCLUSIVE;");
  sqlite.exec("COMMIT;");
  sqlite.exec(SCHEMA_SQL);
  return new CarbonDb(sqlite, dataDir);
}

export { RAW_INLINE_LIMIT };
