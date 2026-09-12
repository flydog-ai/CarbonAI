import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "@carbon-ai/config";
import { newApiKeyId, newUser, type CarbonDb } from "@carbon-ai/db";
import { apiKeyPrefix, hashApiKey, isMintedApiKey, mintApiKeyPlaintext } from "./client-keys.ts";

function insertLiveKey(db: CarbonDb, userId: string, plaintext: string, createdAt = Date.now()): void {
  db.users.insertKey({
    id: newApiKeyId(),
    user_id: userId,
    label: "default",
    key_hash: hashApiKey(plaintext),
    key_prefix: apiKeyPrefix(plaintext),
    key_plain: plaintext,
    created_at: createdAt,
    revoked_at: null,
  });
}

/** Existing desks keep their long keys; homepage prefers a compact mint once one exists. */
export function ensureCompactSiteDeskKey(db: CarbonDb): void {
  const id = db.users.siteDeskId();
  if (!id) return;
  if (db.users.listKeys(id).some((k) => k.key_plain && isMintedApiKey(k.key_plain))) return;
  insertLiveKey(db, id, mintApiKeyPlaintext());
}

export async function ensureBootstrapAdmin(cfg: Config, db: CarbonDb): Promise<void> {
  if (db.users.count() > 0) {
    ensureCompactSiteDeskKey(db);
    return;
  }
  const username = cfg.auth.bootstrapUsername || "admin";
  const password = cfg.auth.bootstrapPassword;
  if (!password) {
    console.log("no users yet — open /console to create the first superadmin");
    return;
  }
  const user = await newUser({ username, password, role: "superadmin", canReply: true });
  db.users.insert(user);
  const plaintext = mintApiKeyPlaintext();
  insertLiveKey(db, user.id, plaintext);
  console.log(`superadmin username: ${username}`);
  console.log("superadmin password: (from carbon.toml / CARBON_BOOTSTRAP_PASSWORD)");
  console.log(`superadmin api key:\n${plaintext}`);
}

/** One-shot: data_dir/reset-bootstrap whose first line is the new password. File is deleted after use. */
export async function resetBootstrapIfRequested(cfg: Config, db: CarbonDb): Promise<boolean> {
  const path = join(cfg.server.dataDir, "reset-bootstrap");
  if (!existsSync(path)) return false;
  const password = readFileSync(path, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
  unlinkSync(path);
  if (password.length < 8) {
    console.log("reset-bootstrap ignored: password must be at least 8 characters");
    return false;
  }
  const username = cfg.auth.bootstrapUsername || "admin";
  const user = db.users.getByUsername(username);
  if (!user) {
    console.log(`reset-bootstrap ignored: no user named ${username}`);
    return false;
  }
  db.users.setPasswordHash(user.id, await Bun.password.hash(password));
  db.sessions.deleteByUser(user.id);
  console.log(`superadmin password reset for ${user.username} (from data_dir/reset-bootstrap)`);
  return true;
}
