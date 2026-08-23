import { createHmac } from "node:crypto";

/** Opaque dummy blob. Not a MAC clients should verify; stable per seed so turn-2 replay matches. */
export function opaqueEncryptedContent(seed: string): string {
  const a = createHmac("sha256", "carbon-ai.reasoning-blob").update(seed).digest();
  const b = createHmac("sha256", "carbon-ai.reasoning-blob").update(seed).update("|2").digest();
  return Buffer.concat([a, b]).toString("base64");
}
