import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CarbonDb } from "./client.ts";

export async function writeBlob(
  db: CarbonDb,
  bytes: Uint8Array,
  mediaType: string,
): Promise<{ sha256: string; path: string; byteLength: number }> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = join(db.blobDir, sha256);
  writeFileSync(path, bytes);
  db.insertBlob({
    sha256,
    media_type: mediaType,
    byte_len: bytes.byteLength,
    path,
  });
  return { sha256, path, byteLength: bytes.byteLength };
}

export function referencedSha256s(normalizedJsonList: string[]): Set<string> {
  const found = new Set<string>();
  const re = /"sha256"\s*:\s*"([a-f0-9]{64})"/g;
  for (const json of normalizedJsonList) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(json))) {
      found.add(m[1]!);
    }
  }
  return found;
}

export function deleteOrphanBlobs(db: CarbonDb): number {
  const refs = referencedSha256s(db.allJobsNormalized().map((r) => r.normalized_json));
  let n = 0;
  for (const blob of db.listBlobs()) {
    if (refs.has(blob.sha256)) continue;
    try {
      unlinkSync(blob.path);
    } catch {
      // already gone
    }
    db.deleteBlob(blob.sha256);
    n++;
  }
  return n;
}
