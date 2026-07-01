import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml } from "smol-toml";
import { DEFAULT_CONFIG, type ApiKey, type BindHost, type Config } from "./types.ts";

export type LoadConfigOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  filePath?: string;
  generateOperatorTokenIfEmpty?: boolean;
};

type TomlFile = {
  server?: {
    host?: string;
    port?: number;
    data_dir?: string;
    max_body_bytes?: number;
  };
  auth?: {
    operator_token?: string;
    api_keys?: ApiKey[];
  };
  jobs?: {
    max_pending?: number;
    max_active?: number;
    wait_timeout_sec?: number;
    heartbeat_interval_ms?: number;
    claim_ttl_ms?: number;
    operator_required?: string;
    timeout_behavior?: string;
    delta_coalesce_ms?: number;
    eager_content_block?: boolean;
    auto_claim?: boolean;
    fake_chunk_text?: boolean;
    fake_chunk_tool_json?: boolean;
    emit_empty_reasoning?: string;
    emit_thinking?: string;
    retention_days?: number;
  };
  models?: {
    default_id?: string;
    default_display?: string;
    aliases?: Record<string, string>;
  };
  cors?: {
    enabled?: boolean;
    origins?: string[];
  };
  openai_chat?: {
    heartbeat?: string;
    midstream_error?: string;
  };
  openai_responses?: {
    heartbeat?: string;
  };
};

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function findConfigFile(cwd: string): string | undefined {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, "carbon.toml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function asBindHost(value: string | undefined, fallback: BindHost): BindHost {
  if (value === "loopback" || value === "127.0.0.1" || value === "0.0.0.0") return value;
  if (value === undefined || value === "") return fallback;
  throw new Error(`Invalid server.host: ${value} (expected loopback | 127.0.0.1 | 0.0.0.0)`);
}

function parseApiKeysJson(raw: string): ApiKey[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("CARBON_API_KEYS must be a JSON array of {label,key}");
  }
  return parsed.map((item, i) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { label?: unknown }).label !== "string" ||
      typeof (item as { key?: unknown }).key !== "string"
    ) {
      throw new Error(`CARBON_API_KEYS[${i}] must be {label: string, key: string}`);
    }
    return { label: (item as ApiKey).label, key: (item as ApiKey).key };
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const filePath = opts.filePath ?? env.CARBON_CONFIG ?? findConfigFile(cwd);

  let file: TomlFile = {};
  if (filePath && existsSync(filePath)) {
    file = parseToml(readFileSync(filePath, "utf8")) as TomlFile;
  }

  const cfg: Config = structuredClone(DEFAULT_CONFIG);

  if (file.server) {
    cfg.server.host = asBindHost(file.server.host, cfg.server.host);
    if (typeof file.server.port === "number") cfg.server.port = file.server.port;
    if (typeof file.server.data_dir === "string") cfg.server.dataDir = file.server.data_dir;
    if (typeof file.server.max_body_bytes === "number") cfg.server.maxBodyBytes = file.server.max_body_bytes;
  }
  if (file.auth) {
    if (typeof file.auth.operator_token === "string") cfg.auth.operatorToken = file.auth.operator_token;
    if (Array.isArray(file.auth.api_keys)) cfg.auth.apiKeys = file.auth.api_keys;
  }
  if (file.jobs) {
    const j = file.jobs;
    if (typeof j.max_pending === "number") cfg.jobs.maxPending = j.max_pending;
    if (typeof j.max_active === "number") cfg.jobs.maxActive = j.max_active;
    if (typeof j.wait_timeout_sec === "number") cfg.jobs.waitTimeoutSec = j.wait_timeout_sec;
    if (typeof j.heartbeat_interval_ms === "number") cfg.jobs.heartbeatIntervalMs = j.heartbeat_interval_ms;
    if (typeof j.claim_ttl_ms === "number") cfg.jobs.claimTtlMs = j.claim_ttl_ms;
    if (j.operator_required === "wait" || j.operator_required === "fail") {
      cfg.jobs.operatorRequired = j.operator_required;
    }
    if (j.timeout_behavior === "error" || j.timeout_behavior === "assistant_message") {
      cfg.jobs.timeoutBehavior = j.timeout_behavior;
    }
    if (typeof j.delta_coalesce_ms === "number") cfg.jobs.deltaCoalesceMs = j.delta_coalesce_ms;
    if (typeof j.eager_content_block === "boolean") cfg.jobs.eagerContentBlock = j.eager_content_block;
    if (typeof j.auto_claim === "boolean") cfg.jobs.autoClaim = j.auto_claim;
    if (typeof j.fake_chunk_text === "boolean") cfg.jobs.fakeChunkText = j.fake_chunk_text;
    if (typeof j.fake_chunk_tool_json === "boolean") cfg.jobs.fakeChunkToolJson = j.fake_chunk_tool_json;
    if (j.emit_empty_reasoning === "auto" || j.emit_empty_reasoning === "always" || j.emit_empty_reasoning === "never") {
      cfg.jobs.emitEmptyReasoning = j.emit_empty_reasoning;
    }
    if (j.emit_thinking === "never" || j.emit_thinking === "always") cfg.jobs.emitThinking = j.emit_thinking;
    if (typeof j.retention_days === "number") cfg.jobs.retentionDays = j.retention_days;
  }
  if (file.models) {
    if (typeof file.models.default_id === "string") cfg.models.defaultId = file.models.default_id;
    if (typeof file.models.default_display === "string") cfg.models.defaultDisplay = file.models.default_display;
    if (file.models.aliases && typeof file.models.aliases === "object") cfg.models.aliases = file.models.aliases;
  }
  if (file.cors) {
    if (typeof file.cors.enabled === "boolean") cfg.cors.enabled = file.cors.enabled;
    if (Array.isArray(file.cors.origins)) cfg.cors.origins = file.cors.origins;
  }
  if (file.openai_chat?.heartbeat === "comment" || file.openai_chat?.heartbeat === "empty_delta") {
    cfg.openaiChat.heartbeat = file.openai_chat.heartbeat;
  }
  if (
    file.openai_responses?.heartbeat === "keepalive" ||
    file.openai_responses?.heartbeat === "comment" ||
    file.openai_responses?.heartbeat === "both"
  ) {
    cfg.openaiResponses.heartbeat = file.openai_responses.heartbeat;
  }

  if (env.CARBON_HOST) cfg.server.host = asBindHost(env.CARBON_HOST, cfg.server.host);
  if (env.CARBON_PORT) cfg.server.port = Number(env.CARBON_PORT);
  if (env.CARBON_DATA_DIR) cfg.server.dataDir = env.CARBON_DATA_DIR;
  if (env.CARBON_OPERATOR_TOKEN) cfg.auth.operatorToken = env.CARBON_OPERATOR_TOKEN;
  if (env.CARBON_API_KEYS) cfg.auth.apiKeys = parseApiKeysJson(env.CARBON_API_KEYS);

  cfg.server.dataDir = expandHome(cfg.server.dataDir);

  const generate = opts.generateOperatorTokenIfEmpty ?? true;
  if (generate && cfg.auth.operatorToken === "") {
    cfg.auth.operatorToken = generateToken();
  }

  if (!Number.isInteger(cfg.server.port) || cfg.server.port < 1 || cfg.server.port > 65535) {
    throw new Error(`Invalid server.port: ${cfg.server.port}`);
  }

  return cfg;
}
