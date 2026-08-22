import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBlob } from "./blobs.ts";
import { openDatabase } from "./client.ts";
import { runRetention } from "./retention.ts";
import type { JobRow } from "./schema.ts";
import { newApiKeyId, newUser } from "./users.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "carbon-db-"));
}

function baseJob(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "job_1",
    status: "pending",
    protocol: "anthropic_messages",
    vendor_id: "msg_1",
    model: "carbon-default",
    client_key_id: "debug",
    client_label: "debug",
    stream: 1,
    request_hash: "abc",
    request_path: null,
    request_json: "{}",
    headers_json: "{}",
    normalized_json: "{}",
    response_json: null,
    events_json: null,
    claimed_by: null,
    claimed_at: null,
    error_json: null,
    input_tokens: 1,
    output_tokens: null,
    created_at: Date.now(),
    started_at: null,
    finished_at: null,
    ...over,
  };
}

describe("users", () => {
  test("insert user and hashed api key lookup", async () => {
    const db = openDatabase(tmp());
    const user = await newUser({ username: "ada", password: "password1", canReply: true });
    db.users.insert(user);
    expect(db.users.getByUsername("ADA")?.id).toBe(user.id);
    const keyHash = createHash("sha256").update("sk-test").digest("hex");
    db.users.insertKey({
      id: newApiKeyId(),
      user_id: user.id,
      label: "t",
      key_hash: keyHash,
      key_prefix: "sk-test…",
      created_at: Date.now(),
      revoked_at: null,
    });
    expect(db.users.getKeyByHash(keyHash)?.user_id).toBe(user.id);
    db.users.updateFlags(user.id, { can_reply: false, disabled: true });
    expect(db.users.getById(user.id)?.can_reply).toBe(0);
    expect(db.users.getById(user.id)?.disabled).toBe(1);
    db.close();
  });
});

describe("CarbonDb", () => {
  test("insert, get, fail in-flight, hash lookup", () => {
    const db = openDatabase(tmp());
    db.insertJob(baseJob({ id: "job_a", request_hash: "h1", status: "streaming" }));
    db.insertJob(baseJob({ id: "job_b", request_hash: "h1", created_at: Date.now() + 1 }));
    expect(db.getJob("job_a")?.model).toBe("carbon-default");
    expect(db.findByHash("h1", "job_b")?.id).toBe("job_a");
    expect(db.failInFlight()).toBe(2);
    expect(db.getJob("job_a")?.status).toBe("failed");
    db.close();
  });

  test("blob sidecar and retention", async () => {
    const dir = tmp();
    const db = openDatabase(dir);
    const bytes = new TextEncoder().encode("hello-blob");
    const blob = await writeBlob(db, bytes, "text/plain");
    expect(readFileSync(blob.path, "utf8")).toBe("hello-blob");
    db.insertJob(
      baseJob({
        id: "old",
        created_at: Date.now() - 40 * 86400_000,
        normalized_json: JSON.stringify({ sha256: blob.sha256 }),
      }),
    );
    const r = runRetention(db, 14);
    expect(r.jobsDeleted).toBe(1);
    expect(r.blobsDeleted).toBe(1);
    db.close();
  });
});
