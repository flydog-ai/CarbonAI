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
