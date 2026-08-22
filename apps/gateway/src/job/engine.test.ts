import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase, type CarbonDb } from "@carbon-ai/db";
import { JobEngine } from "./engine.ts";
import { emptyNormalizedRequest } from "@carbon-ai/protocol";
import { JobQueueFullError } from "./errors.ts";
import { TestAdapter } from "./test-adapter.ts";

function cfg(over: (c: Config) => void): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

function setup(over: (c: Config) => void = () => undefined): { engine: JobEngine; db: CarbonDb } {
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-eng-")));
  const engine = new JobEngine(cfg(over), db);
  return { engine, db };
}

describe("JobEngine", () => {
  test("completeFromTest persists and waitUntilTerminal resolves after writes", async () => {
    const { engine, db } = setup();
    try {
    const raw = new TextEncoder().encode(`{"text":"hello"}`);
    const job = await engine.create({
      protocol: "anthropic_messages",
      stream: false,
      rawBody: raw,
      headers: {},
    });
    const output = await engine.completeFromTest(job.id, [{ type: "text", text: "pong" }]);
    expect(output.blocks).toEqual([{ type: "text", text: "pong" }]);
    const terminal = await engine.waitUntilTerminal(job.id);
    expect(terminal.status).toBe("completed");
    const row = db.getJob(job.id);
    expect(row?.status).toBe("completed");
    expect(row?.events_json).toContain("text_delta");
    } finally {
      engine.stop();
      db.close();
    }
  });

  test("same body is marked as retry of the earlier job", async () => {
    const { engine, db } = setup();
    try {
    const raw = new TextEncoder().encode(`{"text":"same"}`);
    const a = await engine.create({ protocol: "anthropic_messages", stream: true, rawBody: raw, headers: {} });
    const b = await engine.create({ protocol: "anthropic_messages", stream: true, rawBody: raw, headers: {} });
    expect(b.looksLikeRetryOf).toBe(a.id);
    } finally {
      engine.stop();
      db.close();
    }
  });

  test("follow-up messages share a thread id", async () => {
    const { engine, db } = setup();
    try {
      const firstNorm = emptyNormalizedRequest({
        messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      });
      const first = await engine.create({
        protocol: "anthropic_messages",
        stream: true,
        rawBody: new TextEncoder().encode("turn-1"),
        headers: {},
        normalized: firstNorm,
        clientKeyId: "alice",
      });
      const secondNorm = emptyNormalizedRequest({
        messages: [
          { role: "user", parts: [{ type: "text", text: "hello" }] },
          { role: "assistant", parts: [{ type: "text", text: "hi" }] },
          { role: "user", parts: [{ type: "text", text: "next" }] },
        ],
      });
      const second = await engine.create({
        protocol: "anthropic_messages",
        stream: true,
        rawBody: new TextEncoder().encode("turn-2"),
        headers: {},
        normalized: secondNorm,
        clientKeyId: "alice",
      });
      expect(second.threadId).toBe(first.threadId);
      expect(second.turnCount).toBe(3);
      const other = await engine.create({
        protocol: "anthropic_messages",
        stream: true,
        rawBody: new TextEncoder().encode("other"),
        headers: {},
        normalized: emptyNormalizedRequest({
          messages: [{ role: "user", parts: [{ type: "text", text: "unrelated" }] }],
        }),
        clientKeyId: "alice",
      });
      expect(other.threadId).not.toBe(first.threadId);
    } finally {
      engine.stop();
      db.close();
    }
  });

  test("max_pending rejects with JobQueueFullError", async () => {
    const { engine, db } = setup((c) => {
      c.jobs.maxPending = 1;
    });
    try {
    const raw = new TextEncoder().encode("{}");
    await engine.create({ protocol: "anthropic_messages", stream: true, rawBody: raw, headers: {} });
    await expect(
      engine.create({ protocol: "anthropic_messages", stream: true, rawBody: raw, headers: {} }),
    ).rejects.toBeInstanceOf(JobQueueFullError);
    } finally {
      engine.stop();
      db.close();
    }
  });

  test("stream complete awaits delayed adapter writes before terminal", async () => {
    const { engine, db } = setup();
    try {
    const job = await engine.create({
      protocol: "anthropic_messages",
      stream: true,
      rawBody: new TextEncoder().encode("{}"),
      headers: {},
      adapter: new TestAdapter(25),
    });
    const chunks: string[] = [];
    const writer = {
      comment: async (s: string) => {
        chunks.push(`:${s}`);
      },
      data: async (s: string) => {
        chunks.push(s);
      },
      event: async () => undefined,
      drain: async () => undefined,
    };
    const attached = engine.attachSse(job.id, writer);
    await engine.waitUntilAttached(job.id);
    await attached;
    const t0 = performance.now();
    await engine.completeFromTest(job.id, [{ type: "text", text: "x" }]);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(chunks.at(-1)).toBe("[DONE]");
    expect(await engine.waitUntilTerminal(job.id)).toMatchObject({ status: "completed" });
    } finally {
      engine.stop();
      db.close();
    }
  });
});
