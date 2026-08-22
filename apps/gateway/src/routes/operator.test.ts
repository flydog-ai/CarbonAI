import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { JobEngine } from "../job/engine.ts";
import { listen } from "../listen.ts";

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

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

async function withSrv(fn: (url: string) => Promise<void>): Promise<void> {
  const conf: Config = structuredClone(DEFAULT_CONFIG);
  conf.auth.operatorToken = "op-test-token";
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-op-")));
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

describe("operator desk", () => {
  test("GET /ui is html", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/ui`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
      expect(await res.text()).toContain("Operator desk");
    });
  });

  test("jobs require a session; login + complete round-trip", async () => {
    await withSrv(async (url) => {
      const denied = await fetch(`${url}/api/operator/jobs`);
      expect(denied.status).toBe(401);

      const bad = await fetch(`${url}/api/operator/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "nope" }),
      });
      expect(bad.status).toBe(401);

      const login = await fetch(`${url}/api/operator/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "op-test-token" }),
      });
      expect(login.status).toBe(200);
      const cookie = cookieFrom(login);
      expect(cookie.startsWith("carbon_op=")).toBe(true);
      const auth = { cookie };

      const created = await fetch(`${url}/debug/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream: true, text: "hello from client" }),
      });
      expect(created.status).toBe(201);
      const job = (await created.json()) as { id: string };
      const sse = fetch(`${url}/debug/jobs/${job.id}/stream`);
      await Bun.sleep(40);

      const list = await fetch(`${url}/api/operator/jobs`, { headers: auth });
      expect(list.status).toBe(200);
      const listed = (await list.json()) as { jobs: { id: string; lastUserPreview: string }[] };
      expect(listed.jobs.some((j) => j.id === job.id)).toBe(true);
      expect(listed.jobs.find((j) => j.id === job.id)?.lastUserPreview).toContain("hello from client");

      const ctx = await fetch(`${url}/api/operator/jobs/${job.id}/context?limit=20`, { headers: auth });
      expect(ctx.status).toBe(200);
      const page = (await ctx.json()) as { blocks: { excerpt: string }[]; hasMore: boolean };
      expect(page.blocks.some((b) => b.excerpt.includes("hello from client"))).toBe(true);

      const done = await fetch(`${url}/api/operator/jobs/${job.id}/complete`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ text: "pong from desk" }),
      });
      expect(done.status).toBe(200);
      const out = (await done.json()) as { blocks: { text?: string }[] };
      expect(out.blocks.some((b) => b.text === "pong from desk")).toBe(true);
      const sseRes = await sse;
      expect(sseRes.status).toBe(200);
      expect(await sseRes.text()).toContain("pong from desk");
    });
  });
});
