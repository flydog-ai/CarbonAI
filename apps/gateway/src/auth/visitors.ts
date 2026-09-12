import type { CarbonDb, VisitorRow } from "@carbon-ai/db";
import { newVisitorId, newVisitorShortId } from "@carbon-ai/db";
import { apiKeyPrefix, hashApiKey, mintApiKeyPlaintext, type ClientIdentity } from "./client-keys.ts";
import type { ClientKind, RequestSight } from "./sight.ts";
import { visitorFingerprint } from "./sight.ts";

export const VISITOR_COOKIE = "carbon_vid";
export const VISITOR_COOKIE_TTL_SEC = 400 * 24 * 60 * 60;

export type RememberedCaller = {
  clientKeyId: string;
  clientLabel: string;
  callerLabel: string;
  visitorId?: string;
  userId?: string;
  keyPrefix?: string;
};

function mintShortId(db: CarbonDb): string {
  for (let i = 0; i < 8; i++) {
    const short = newVisitorShortId();
    if (!db.visitors.getByShortId(short)) return short;
  }
  return newVisitorShortId();
}

function mintVisitorKey(db: CarbonDb, id: string): { key_hash: string; key_prefix: string; key_plain: string } {
  const key_plain = mintApiKeyPlaintext();
  const key = {
    key_hash: hashApiKey(key_plain),
    key_prefix: apiKeyPrefix(key_plain),
    key_plain,
  };
  db.visitors.setKey(id, key);
  return key;
}

function createVisitor(db: CarbonDb, sight: RequestSight, now: number, withKey: boolean): VisitorRow {
  const id = newVisitorId();
  const key_plain = withKey ? mintApiKeyPlaintext() : null;
  const row: VisitorRow = {
    id,
    short_id: mintShortId(db),
    fingerprint: visitorFingerprint(sight.ip, sight.userAgent),
    key_hash: key_plain ? hashApiKey(key_plain) : null,
    key_prefix: key_plain ? apiKeyPrefix(key_plain) : null,
    key_plain,
    ip: sight.ip,
    user_agent: sight.userAgent || null,
    last_client: sight.clientKind,
    last_protocol: null,
    last_seen_at: now,
    created_at: now,
    last_key_prefix: null,
  };
  db.visitors.insert(row);
  return row;
}

function touchVisitor(db: CarbonDb, row: VisitorRow, sight: RequestSight, protocol?: string): VisitorRow {
  db.visitors.touch(row.id, {
    last_seen_at: Date.now(),
    ip: sight.ip,
    user_agent: sight.userAgent || undefined,
    last_client: sight.clientKind,
    last_protocol: protocol,
  });
  return db.visitors.getById(row.id) ?? row;
}

function ensureKey(db: CarbonDb, row: VisitorRow): VisitorRow {
  if (row.key_plain && row.key_hash) return row;
  mintVisitorKey(db, row.id);
  return db.visitors.getById(row.id) ?? row;
}

/** Homepage: cookie first, then same IP+UA, else a new guest with its own key. */
export function issueHomepageVisitor(db: CarbonDb, sight: RequestSight, cookieId?: string): VisitorRow {
  const now = Date.now();
  if (cookieId) {
    const byCookie = db.visitors.getById(cookieId);
    if (byCookie) return ensureKey(db, touchVisitor(db, byCookie, sight));
  }
  const byFp = db.visitors.getByFingerprint(visitorFingerprint(sight.ip, sight.userAgent));
  if (byFp) return ensureKey(db, touchVisitor(db, byFp, sight));
  return createVisitor(db, sight, now, true);
}

export function rememberCaller(
  db: CarbonDb,
  client: ClientIdentity,
  sight: RequestSight,
  opts: { protocol?: string } = {},
): RememberedCaller {
  const now = Date.now();
  if (client.userId) {
    db.users.touchLastSeen(client.userId, now);
    return {
      clientKeyId: client.keyId,
      clientLabel: client.label,
      callerLabel: client.label,
      userId: client.userId,
      keyPrefix: client.keyPrefix,
    };
  }
  // Guest keys are tickets, not identity — a shared promo key is many people.
  // Who it is = connecting IP + user-agent (and thus client kind).
  // The presented key is still associated on the visitor and the job.
  const fp = visitorFingerprint(sight.ip, sight.userAgent);
  const existing = db.visitors.getByFingerprint(fp);
  const row = existing
    ? touchVisitor(db, existing, sight, opts.protocol)
    : createVisitor(db, sight, now, false);
  db.visitors.touch(row.id, {
    last_seen_at: Date.now(),
    last_protocol: opts.protocol,
    last_client: sight.clientKind,
    last_key_prefix: client.keyPrefix,
  });
  return {
    clientKeyId: row.id,
    clientLabel: client.label,
    callerLabel: row.short_id,
    visitorId: row.id,
    keyPrefix: client.keyPrefix ?? row.key_prefix ?? undefined,
  };
}

export function clientKindLabel(kind: ClientKind | string | undefined): string | undefined {
  switch (kind) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "openai-chat":
      return "OpenAI Chat";
    case "anthropic":
      return "Anthropic";
    case "browser":
      return "Browser";
    case "unknown":
      return "Agent";
    default:
      return kind || undefined;
  }
}
