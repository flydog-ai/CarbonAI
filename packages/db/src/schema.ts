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
  finished_at   INTEGER,
  thread_id     TEXT,
  turn_count    INTEGER,
  last_user_preview TEXT,
  deleted_at    INTEGER,
  visitor_id    TEXT,
  client_kind   TEXT,
  client_ip     TEXT,
  caller_label  TEXT
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
CREATE INDEX IF NOT EXISTS jobs_client_created ON jobs(client_key_id, created_at);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  can_reply     INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  label      TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  key_plain  TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS visitors (
  id            TEXT PRIMARY KEY,
  short_id      TEXT NOT NULL UNIQUE,
  fingerprint   TEXT NOT NULL,
  key_hash      TEXT UNIQUE,
  key_prefix    TEXT,
  key_plain     TEXT,
  ip            TEXT,
  user_agent    TEXT,
  last_client   TEXT,
  last_protocol TEXT,
  last_seen_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS visitors_fingerprint ON visitors(fingerprint);
CREATE INDEX IF NOT EXISTS visitors_seen ON visitors(last_seen_at);
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
  thread_id: string | null;
  turn_count: number | null;
  last_user_preview: string | null;
  deleted_at: number | null;
  visitor_id: string | null;
  client_kind: string | null;
  client_ip: string | null;
  caller_label: string | null;
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
  last_seen_at: number | null;
};

export type ApiKeyRow = {
  id: string;
  user_id: string;
  label: string;
  key_hash: string;
  key_prefix: string;
  key_plain: string | null;
  created_at: number;
  revoked_at: number | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
};

export type VisitorRow = {
  id: string;
  short_id: string;
  fingerprint: string;
  key_hash: string | null;
  key_prefix: string | null;
  key_plain: string | null;
  ip: string | null;
  user_agent: string | null;
  last_client: string | null;
  last_protocol: string | null;
  last_seen_at: number;
  created_at: number;
};
