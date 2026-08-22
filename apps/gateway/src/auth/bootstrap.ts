import type { Config } from "@carbon-ai/config";
import { newApiKeyId, newUser, type CarbonDb } from "@carbon-ai/db";
import { apiKeyPrefix, hashApiKey, mintApiKeyPlaintext } from "./client-keys.ts";

function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function ensureBootstrapAdmin(cfg: Config, db: CarbonDb): Promise<void> {
  if (db.users.count() > 0) return;
  const username = cfg.auth.bootstrapUsername || "admin";
  const password = cfg.auth.bootstrapPassword || generateSecret();
  const generated = cfg.auth.bootstrapPassword === "";
  const user = await newUser({ username, password, role: "superadmin", canReply: true });
  db.users.insert(user);
  const plaintext = mintApiKeyPlaintext();
  db.users.insertKey({
    id: newApiKeyId(),
    user_id: user.id,
    label: "default",
    key_hash: hashApiKey(plaintext),
    key_prefix: apiKeyPrefix(plaintext),
    created_at: Date.now(),
    revoked_at: null,
  });
  console.log(`superadmin username: ${username}`);
  if (generated) console.log(`superadmin password:\n${password}`);
  else console.log("superadmin password: (from carbon.toml)");
  console.log(`superadmin api key (shown once):\n${plaintext}`);
}
