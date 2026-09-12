import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@carbon-ai/config";
import type { CarbonDb } from "@carbon-ai/db";

export type ClientIdentity = {
  label: string;
  keyId: string;
  userId?: string;
  visitorId?: string;
  keyPrefix?: string;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function secretsEqual(presented: string, stored: string): boolean {
  const a = sha256(presented);
  const b = sha256(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

function unwrapKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let s = value.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}

/** Any client key header: x-api-key, Bearer, or api-key. Same secret works for every protocol. */
export function presentedClientKey(headers: Headers): string | undefined {
  const named = unwrapKey(headers.get("x-api-key")) ?? unwrapKey(headers.get("api-key")) ?? unwrapKey(headers.get("anthropic-api-key"));
  if (named) return named;
  const auth = headers.get("authorization")?.trim();
  if (!auth) return undefined;
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer?.[1]) return unwrapKey(bearer[1]);
  if (/^Basic\s+/i.test(auth)) return undefined;
  return unwrapKey(auth);
}

export function verifyClientKey(
  cfg: Config,
  presented: string | undefined,
  db?: CarbonDb,
): ClientIdentity | undefined {
  if (!presented) return undefined;
  const presentedHash = sha256(presented);
  if (db) {
    const row = db.users.getKeyByHash(presentedHash.toString("hex"));
    if (row) {
      if (row.revoked_at == null) {
        const user = db.users.getById(row.user_id);
        if (user && !user.disabled) {
          return { label: user.username, keyId: row.id, userId: user.id, keyPrefix: apiKeyPrefix(presented) };
        }
      }
      return undefined;
    }
    const visitor = db.visitors.getByKeyHash(presentedHash.toString("hex"));
    if (visitor) {
      return { label: visitor.short_id, keyId: visitor.id, visitorId: visitor.id, keyPrefix: apiKeyPrefix(presented) };
    }
  }
  const keys = cfg.auth.apiKeys.filter((k) => k.key.length > 0);
  if (keys.length === 0 && !db) {
    return { label: "local", keyId: "local", keyPrefix: apiKeyPrefix(presented) };
  }
  for (const key of keys) {
    const stored = sha256(key.key);
    if (stored.length === presentedHash.length && timingSafeEqual(stored, presentedHash)) {
      return { label: key.label, keyId: key.label, keyPrefix: apiKeyPrefix(presented) };
    }
  }
  return undefined;
}

export function hashApiKey(plaintext: string): string {
  return sha256(plaintext).toString("hex");
}

/** `sk-carbon-` plus 16 base64url chars (12 random bytes). 26 chars total.
 *  Stays above common client floors: non-empty (Claude Code, Codex, CC Switch),
 *  ≥16 overall (some OpenAI gateways), and `sk-` + ≥20 chars (Authsome-style forms).
 */
export const MINTED_API_KEY_RE = /^sk-carbon-[A-Za-z0-9_-]{16}$/;

export function isMintedApiKey(value: string): boolean {
  return MINTED_API_KEY_RE.test(value);
}

export function mintApiKeyPlaintext(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sk-carbon-${Buffer.from(bytes).toString("base64url")}`;
}

export function apiKeyPrefix(plaintext: string): string {
  if (plaintext.length < 16) return plaintext;
  return `${plaintext.slice(0, 12)}...${plaintext.slice(-4)}`;
}
