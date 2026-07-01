import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@carbon-ai/config";

export type ClientIdentity = {
  label: string;
  keyId: string;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function presentedClientKey(headers: Headers): string | undefined {
  const x = headers.get("x-api-key")?.trim();
  if (x) return x;
  const auth = headers.get("authorization");
  if (!auth) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim();
}

export function verifyClientKey(cfg: Config, presented: string | undefined): ClientIdentity | undefined {
  if (!presented) return undefined;
  const presentedHash = sha256(presented);
  const keys = cfg.auth.apiKeys.filter((k) => k.key.length > 0);
  if (keys.length === 0) {
    return { label: "local", keyId: "local" };
  }
  for (const key of keys) {
    const stored = sha256(key.key);
    if (stored.length === presentedHash.length && timingSafeEqual(stored, presentedHash)) {
      return { label: key.label, keyId: key.label };
    }
  }
  return undefined;
}
