import type { CarbonDb } from "./client.ts";
import { deleteOrphanBlobs } from "./blobs.ts";

export function runRetention(db: CarbonDb, retentionDays: number, now = Date.now()): {
  jobsDeleted: number;
  blobsDeleted: number;
} {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const jobsDeleted = db.deleteOlderThan(cutoff);
  const blobsDeleted = deleteOrphanBlobs(db);
  return { jobsDeleted, blobsDeleted };
}
