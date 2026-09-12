import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@carbon-ai/db";
import { hashApiKey } from "./client-keys.ts";
import type { RequestSight } from "./sight.ts";
import { issueHomepageVisitor, rememberCaller } from "./visitors.ts";

function tmpDb() {
  return openDatabase(mkdtempSync(join(tmpdir(), "carbon-vis-")));
}

function sight(over: Partial<RequestSight> = {}): RequestSight {
  return { ip: "203.0.113.8", userAgent: "Mozilla/5.0 Chrome/120", clientKind: "browser", ...over };
}

describe("issueHomepageVisitor", () => {
  test("reuses the cookie and keeps the same key", () => {
    const db = tmpDb();
    const a = issueHomepageVisitor(db, sight());
    expect(a.short_id.startsWith("G-")).toBe(true);
    expect(a.key_plain?.startsWith("sk-carbon-")).toBe(true);
    const b = issueHomepageVisitor(db, sight({ ip: "198.51.100.2" }), a.id);
    expect(b.id).toBe(a.id);
    expect(b.key_plain).toBe(a.key_plain);
    expect(b.ip).toBe("198.51.100.2");
    db.close();
  });

  test("same IP and browser without a cookie reuse the fingerprint", () => {
    const db = tmpDb();
    const a = issueHomepageVisitor(db, sight());
    const b = issueHomepageVisitor(db, sight());
    expect(b.id).toBe(a.id);
    db.close();
  });
});

describe("rememberCaller", () => {
  test("named keys stay the account; guest keys identify by connecting IP and user-agent", () => {
    const db = tmpDb();
    const home = issueHomepageVisitor(db, sight());
    const fromCli = rememberCaller(
      db,
      { label: home.short_id, keyId: home.id, visitorId: home.id, keyPrefix: "sk-carbon-ab...xyz" },
      sight({ userAgent: "claude-cli/1.0", clientKind: "claude-code" }),
      { protocol: "anthropic_messages" },
    );
    expect(fromCli.visitorId).not.toBe(home.id);
    expect(fromCli.callerLabel.startsWith("G-")).toBe(true);
    expect(fromCli.keyPrefix).toBe("sk-carbon-ab...xyz");
    expect(db.visitors.getById(fromCli.visitorId!)?.last_key_prefix).toBe("sk-carbon-ab...xyz");
    expect(db.visitors.getById(fromCli.visitorId!)?.last_client).toBe("claude-code");

    const sameCli = rememberCaller(
      db,
      { label: "shared", keyId: "shared" },
      sight({ userAgent: "claude-cli/1.0", clientKind: "claude-code" }),
      { protocol: "anthropic_messages" },
    );
    expect(sameCli.visitorId).toBe(fromCli.visitorId);

    const toml = rememberCaller(
      db,
      { label: "Claude Code", keyId: "Claude Code" },
      sight({ ip: "198.51.100.4", userAgent: "codex-cli/0.1", clientKind: "codex" }),
      { protocol: "openai_responses" },
    );
    expect(toml.visitorId).not.toBe(fromCli.visitorId);
    expect(toml.visitorId).not.toBe(home.id);
    expect(db.visitors.getByKeyHash(hashApiKey(home.key_plain!))?.id).toBe(home.id);

    const named = rememberCaller(
      db,
      { label: "admin", keyId: "key_admin", userId: "usr_admin", keyPrefix: "sk-carbon-ab...xyz" },
      sight({ userAgent: "claude-cli/1.0", clientKind: "claude-code" }),
      { protocol: "anthropic_messages" },
    );
    expect(named.userId).toBe("usr_admin");
    expect(named.callerLabel.startsWith("G-")).toBe(true);
    expect(named.visitorId).toBe(fromCli.visitorId);
    db.close();
  });
});
