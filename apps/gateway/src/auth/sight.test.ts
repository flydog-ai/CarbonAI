import { describe, expect, test } from "bun:test";
import { canonicalIp, inferClientKind, presenceOf, visitorFingerprint } from "./sight.ts";

describe("canonicalIp", () => {
  test("folds loopback forms", () => {
    expect(canonicalIp("::1")).toBe("127.0.0.1");
    expect(canonicalIp("[::1]")).toBe("127.0.0.1");
    expect(canonicalIp("::ffff:203.0.113.4")).toBe("203.0.113.4");
  });
});

describe("inferClientKind", () => {
  test("reads well-known user agents first", () => {
    expect(inferClientKind({ userAgent: "claude-cli/1.0.0" })).toBe("claude-code");
    expect(inferClientKind({ userAgent: "codex-cli/0.2" })).toBe("codex");
    expect(inferClientKind({ userAgent: "OpenAI/Python 1.40" })).toBe("openai-chat");
    expect(inferClientKind({ userAgent: "Mozilla/5.0 Chrome/120" })).toBe("browser");
  });

  test("falls back to vendor protocol on API calls", () => {
    expect(inferClientKind({ protocol: "anthropic_messages" })).toBe("claude-code");
    expect(inferClientKind({ protocol: "openai_responses" })).toBe("codex");
    expect(inferClientKind({ protocol: "openai_chat" })).toBe("openai-chat");
    expect(inferClientKind({ userAgent: "Mozilla/5.0", protocol: "openai_responses" })).toBe("codex");
  });
});

describe("visitorFingerprint", () => {
  test("is stable for the same ip and user-agent", () => {
    const a = visitorFingerprint("127.0.0.1", "Claude-CLI/1.0");
    const b = visitorFingerprint("127.0.0.1", "claude-cli/1.0");
    expect(a).toBe(b);
    expect(visitorFingerprint("203.0.113.1", "claude-cli/1.0")).not.toBe(a);
  });
});

describe("presenceOf", () => {
  test("live wins; recent last-seen is online", () => {
    expect(presenceOf({ live: true, lastSeenAt: 0, now: 10_000 })).toBe("live");
    expect(presenceOf({ live: false, lastSeenAt: 9_000, now: 10_000 })).toBe("online");
    expect(presenceOf({ live: false, lastSeenAt: 1, now: 200_000 })).toBe("idle");
  });
});
