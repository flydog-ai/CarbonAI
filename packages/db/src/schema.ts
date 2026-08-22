export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL,
  protocol      TEXT NOT NULL,
  vendor_id     TEXT NOT NULL,
  model         TEXT NOT NULL,
  client_key_id TEXT NOT NULL,
  client_label  TEXT NOT NULL,
  stream        INTEGER NOT NULL,
  request_hash  TEXT NOT NULL,
  request_path  TEXT,
  request_json  TEXT,
  headers_json  TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  response_json TEXT,
  events_json   TEXT,
  claimed_by    TEXT,
  claimed_at    INTEGER,
  error_json    TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER
);

CREATE TABLE IF NOT EXISTS blobs (
  sha256     TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  byte_len   INTEGER NOT NULL,
  path       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_vendor_id ON jobs(vendor_id);
CREATE INDEX IF NOT EXISTS jobs_request_hash ON jobs(request_hash);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  can_reply     INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  label      TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys(key_hash);
`;

export type JobRow = {
  id: string;
  status: string;
  protocol: string;
  vendor_id: string;
  model: string;
  client_key_id: string;
  client_label: string;
  stream: number;
  request_hash: string;
  request_path: string | null;
  request_json: string | null;
  headers_json: string;
  normalized_json: string;
  response_json: string | null;
  events_json: string | null;
  claimed_by: string | null;
  claimed_at: number | null;
  error_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export type BlobRow = {
  sha256: string;
  media_type: string;
  byte_len: number;
  path: string;
};

export type UserRole = "user" | "superadmin";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  can_reply: number;
  disabled: number;
  created_at: number;
};

export type ApiKeyRow = {
  id: string;
  user_id: string;
  label: string;
  key_hash: string;
  key_prefix: string;
  created_at: number;
  revoked_at: number | null;
};
