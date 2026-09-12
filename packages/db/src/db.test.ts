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
import { newBindingId, newChannelId } from "./channels.ts";
import { newVisitorId, newVisitorShortId } from "./visitors.ts";

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
    thread_id: null,
    turn_count: null,
    last_user_preview: null,
    deleted_at: null,
    visitor_id: null,
    client_kind: null,
    client_ip: null,
    caller_label: null,
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
      key_plain: "sk-test",
      created_at: Date.now(),
      revoked_at: null,
    });
    expect(db.users.getKeyByHash(keyHash)?.user_id).toBe(user.id);
    expect(db.users.listKeys(user.id)[0]?.key_plain).toBe("sk-test");
    const doomed = newApiKeyId();
    db.users.insertKey({
      id: doomed,
      user_id: user.id,
      label: "gone",
      key_hash: createHash("sha256").update("sk-gone").digest("hex"),
      key_prefix: "sk-gone…gone",
      key_plain: "sk-gone",
      created_at: Date.now(),
      revoked_at: null,
    });
    db.users.deleteKey(doomed);
    expect(db.users.getKey(doomed)).toBeNull();
    const leftover = newApiKeyId();
    db.users.insertKey({
      id: leftover,
      user_id: user.id,
      label: "old-revoke",
      key_hash: createHash("sha256").update("sk-old").digest("hex"),
      key_prefix: "sk-old…old",
      key_plain: null,
      created_at: Date.now(),
      revoked_at: Date.now(),
    });
    expect(db.users.listKeys(user.id).some((k) => k.id === leftover)).toBe(false);
    db.settings.set("site.name", "Desk");
    expect(db.settings.get("site.name")).toBe("Desk");
    expect(db.settings.getAll()["site.name"]).toBe("Desk");
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

  test("login sessions persist, expire, and delete", async () => {
    const db = openDatabase(tmp());
    const user = await newUser({ username: "ada", password: "password1" });
    db.users.insert(user);
    db.sessions.insert({
      id: "sess_live",
      user_id: user.id,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
    });
    db.sessions.insert({
      id: "sess_old",
      user_id: user.id,
      created_at: Date.now() - 120_000,
      expires_at: Date.now() - 60_000,
    });
    expect(db.sessions.get("sess_live")?.user_id).toBe(user.id);
    expect(db.sessions.deleteExpired()).toBe(1);
    expect(db.sessions.get("sess_old")).toBeNull();
    expect(db.sessions.get("sess_live")).not.toBeNull();
    expect(db.sessions.deleteByUser(user.id)).toBe(1);
    expect(db.sessions.get("sess_live")).toBeNull();
    db.close();
  });
});

describe("visitors", () => {
  test("persist guest identity, key lookup, and last seen", () => {
    const db = openDatabase(tmp());
    const id = newVisitorId();
    const short = newVisitorShortId();
    expect(short.startsWith("G-")).toBe(true);
    expect(short.length).toBe(7);
    db.visitors.insert({
      id,
      short_id: short,
      fingerprint: "fp-1",
      key_hash: "hash-1",
      key_prefix: "sk-carbon-ab...xyz",
      key_plain: "sk-carbon-guest",
      ip: "203.0.113.9",
      user_agent: "claude-cli/1.0",
      last_client: "claude-code",
      last_protocol: "anthropic_messages",
      last_seen_at: 1,
      created_at: 1,
    });
    expect(db.visitors.getById(id)?.short_id).toBe(short);
    expect(db.visitors.getByKeyHash("hash-1")?.id).toBe(id);
    expect(db.visitors.getByFingerprint("fp-1")?.ip).toBe("203.0.113.9");
    db.visitors.touch(id, { last_seen_at: 9, last_client: "codex", ip: "203.0.113.10" });
    const after = db.visitors.getById(id);
    expect(after?.last_seen_at).toBe(9);
    expect(after?.last_client).toBe("codex");
    expect(after?.ip).toBe("203.0.113.10");
    expect(db.visitors.listRecent(8, 10).map((v) => v.id)).toEqual([id]);
    db.close();
  });
});

describe("channels", () => {
  test("upsert wechat account and bind peer to user", async () => {
    const db = openDatabase(tmp());
    const user = await newUser({ username: "op", password: "password1", canReply: true });
    db.users.insert(user);
    const id = newChannelId();
    db.channels.upsertByKind({
      id,
      kind: "wechat_mp",
      label: "WeChat MP",
      app_id: "wxapp",
      app_secret: "secret",
      token: "tok",
      aes_key: null,
      enabled: 1,
      created_at: 1,
    });
    db.channels.upsertByKind({
      id: newChannelId(),
      kind: "wechat_mp",
      label: "WeChat MP",
      app_id: "wxapp2",
      app_secret: "secret",
      token: "tok2",
      aes_key: null,
      enabled: 1,
      created_at: 2,
    });
    expect(db.channels.getByKind("wechat_mp")?.app_id).toBe("wxapp2");
    const account = db.channels.getByKind("wechat_mp")!;
    db.channels.insertBinding({
      id: newBindingId(),
      account_id: account.id,
      user_id: user.id,
      peer_id: "openid-a",
      created_at: 3,
    });
    expect(db.channels.getBindingByPeer(account.id, "openid-a")?.user_id).toBe(user.id);
    db.close();
  });
});
