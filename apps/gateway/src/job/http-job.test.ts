import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase, type CarbonDb } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { isSseContentType } from "../http/sse-headers.ts";
import { listen, type ListenHandle } from "../listen.ts";
import { JobEngine } from "./engine.ts";

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

function cfg(over: (c: Config) => void = () => undefined): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

async function start(over: (c: Config) => void = () => undefined): Promise<{
  url: string;
  handle: ListenHandle;
  engine: JobEngine;
  db: CarbonDb;
}> {
  const conf = cfg(over);
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-http-job-")));
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine });
  let lastErr: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      const handle = listen(app.fetch, {
        host: "127.0.0.1",
        port: pickPort(),
        idleTimeout: 0,
      });
      return { url: `http://127.0.0.1:${handle.port}`, handle, engine, db };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("bind failed");
}

async function withSrv(
  fn: (srv: Awaited<ReturnType<typeof start>>) => Promise<void>,
  over: (c: Config) => void = () => undefined,
): Promise<void> {
  const srv = await start(over);
  try {
    await fn(srv);
  } finally {
    srv.handle.stop();
    srv.engine.stop();
    srv.db.close();
  }
}

describe("HTTP job engine", () => {
  test("stream: last frame [DONE] before body end", async () => {
    await withSrv(async (srv) => {
    const created = await fetch(`${srv.url}/debug/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true, text: "hello" }),
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string };
    const sse = await fetch(`${srv.url}/debug/jobs/${job.id}/stream`);
    expect(isSseContentType(sse.headers.get("content-type"))).toBe(true);

    const complete = fetch(`${srv.url}/debug/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "pong" }),
    });

    const reader = sse.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    let sawDoneBeforeEnd = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.includes("data: [DONE]")) sawDoneBeforeEnd = true;
    }
    expect(sawDoneBeforeEnd).toBe(true);
    expect(buf).toContain('"type":"open"');
    expect(buf).toContain("pong");
    const out = await complete;
    expect(out.status).toBe(200);
    });
  });

  test("non-stream wait returns folded JSON after complete", async () => {
    await withSrv(async (srv) => {
    const created = await fetch(`${srv.url}/debug/jobs`, {
      method: "POST",
      body: JSON.stringify({ stream: false, text: "q" }),
    });
    const job = (await created.json()) as { id: string };
    const wait = fetch(`${srv.url}/debug/jobs/${job.id}/wait`);
    await Bun.sleep(20);
    await fetch(`${srv.url}/debug/jobs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ text: "answer" }),
    });
    const res = await wait;
    expect(res.status).toBe(200);
    const json = (await res.json()) as { blocks: { text: string }[] };
    expect(json.blocks[0]?.text).toBe("answer");
    });
  });

  test("client abort cancels the job", async () => {
    await withSrv(async (srv) => {
    const created = await fetch(`${srv.url}/debug/jobs`, {
      method: "POST",
      body: JSON.stringify({ stream: true }),
    });
    const job = (await created.json()) as { id: string };
    const ac = new AbortController();
    const sse = await fetch(`${srv.url}/debug/jobs/${job.id}/stream`, { signal: ac.signal });
    await sse.body?.getReader().read();
    ac.abort();
    const deadline = Date.now() + 2000;
    let status = "";
    while (Date.now() < deadline) {
      const r = await fetch(`${srv.url}/debug/jobs/${job.id}`);
      const j = (await r.json()) as { status: string };
      status = j.status;
      if (status === "cancelled") break;
      await Bun.sleep(50);
    }
    expect(status).toBe("cancelled");
    });
  });

  test("413 when body exceeds max_body_bytes", async () => {
    await withSrv(
      async (srv) => {
    const res = await fetch(`${srv.url}/debug/jobs`, {
      method: "POST",
      body: "x".repeat(100),
    });
    expect(res.status).toBe(413);
      },
      (c) => {
        c.server.maxBodyBytes = 32;
      },
    );
  });

  test("429 when pending queue is full", async () => {
    await withSrv(
      async (srv) => {
    const a = await fetch(`${srv.url}/debug/jobs`, { method: "POST", body: JSON.stringify({ stream: true }) });
    expect(a.status).toBe(201);
    const b = await fetch(`${srv.url}/debug/jobs`, { method: "POST", body: JSON.stringify({ stream: true }) });
    expect(b.status).toBe(429);
    const json = (await b.json()) as { error: { type: string } };
    expect(json.error.type).toBe("rate_limit_error");
      },
      (c) => {
        c.jobs.maxPending = 1;
      },
    );
  });
});
