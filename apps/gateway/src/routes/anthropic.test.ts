import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { isSseContentType } from "../http/sse-headers.ts";
import { listen } from "../listen.ts";
import { JobEngine } from "../job/engine.ts";
import { createApp } from "../app.ts";

function pickPort(): number {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ok"),
  });
  const port = probe.port;
  probe.stop(true);
  return port;
}

async function withSrv(fn: (url: string, engine: JobEngine) => Promise<void>, over: (c: Config) => void = () => undefined): Promise<void> {
  const conf = structuredClone(DEFAULT_CONFIG);
  over(conf);
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-anth-")));
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`, engine);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

const headers = {
  "content-type": "application/json",
  "x-api-key": "sk-carbon-local",
  "anthropic-version": "2023-06-01",
};

describe("Anthropic HTTP", () => {
  test("GET /v1/models lists default and claude aliases", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/models?limit=1000`, { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string }[] };
      const ids = body.data.map((m) => m.id);
      expect(ids[0]).toBe("claude-fable-5-1");
      expect(ids).toContain("carbon-default");
      expect(ids).toContain("gpt-5");
      expect(ids.indexOf("claude-fable-5-1")).toBeLessThan(ids.indexOf("gpt-5"));
    });
  });

  test("POST /v1/messages 401 without key", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "carbon-default", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(401);
    }, (c) => {
      c.auth.apiKeys = [{ label: "Claude Code", key: "sk-carbon-local" }];
    });
  });

  test("stream hangs with message_start then completes", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 32,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(isSseContentType(sse.headers.get("content-type"))).toBe(true);

      const jobs = (await (await fetch(`${url}/debug/jobs`)).json()) as { jobs: { id: string }[] };
      const id = jobs.jobs[0]?.id;
      expect(id).toBeTruthy();

      const complete = fetch(`${url}/debug/jobs/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "pong" }),
      });

      const reader = sse.body?.getReader();
      if (!reader) throw new Error("no body");
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
      }
      expect(buf).toContain("event: message_start");
      expect(buf).toContain("event: ping");
      expect(buf).toContain("pong");
      expect(buf).toContain("event: message_stop");
      expect((await complete).status).toBe(200);
    });
  });

  test("count_tokens returns a number", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/messages/count_tokens`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          messages: [{ role: "user", content: "你好" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { input_tokens: number };
      expect(body.input_tokens).toBeGreaterThan(0);
    });
  });
});
