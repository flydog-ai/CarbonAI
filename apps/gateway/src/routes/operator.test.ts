import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { emptyNormalizedRequest } from "@carbon-ai/protocol";
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

async function withSrv(fn: (url: string, engine: JobEngine) => Promise<void>): Promise<void> {
  const conf: Config = structuredClone(DEFAULT_CONFIG);
  conf.auth.bootstrapUsername = "admin";
  conf.auth.bootstrapPassword = "password1";
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-op-")));
  await ensureBootstrapAdmin(conf, db);
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine, db });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`, engine);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

describe("operator desk", () => {
  test("GET /console is html; /ui redirects", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/console`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Console");
      expect(html).toContain('id="root"');
      expect(html).not.toContain("data-i18n");
      const slash = await fetch(`${url}/console/`);
      expect(slash.status).toBe(200);
      const missingAsset = await fetch(`${url}/console/assets/missing-test.js`);
      expect(missingAsset.status).toBe(404);
      const escape = await fetch(`${url}/console/../../package.json`);
      expect(escape.status).not.toBe(200);
      const dist = join(import.meta.dir, "../../../console/dist");
      if (existsSync(join(dist, "index.html"))) {
        expect(html).toContain("/console/assets/");
        const js = readdirSync(join(dist, "assets")).find((f) => f.endsWith(".js"));
        expect(js).toBeTruthy();
        const asset = await fetch(`${url}/console/assets/${js}`);
        expect(asset.status).toBe(200);
        expect(asset.headers.get("content-type") ?? "").toMatch(/javascript|ecmascript/);
      }
      const redir = await fetch(`${url}/ui`, { redirect: "manual" });
      expect(redir.status).toBe(302);
      expect(redir.headers.get("location") ?? "").toContain("/console");
    });
  });

  test("jobs require a session; login + complete round-trip", async () => {
    await withSrv(async (url) => {
      const denied = await fetch(`${url}/api/operator/jobs`);
      expect(denied.status).toBe(401);

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      expect(login.status).toBe(200);
      const cookie = cookieFrom(login);
      expect(cookie.startsWith("carbon_user=")).toBe(true);
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
      const after = await fetch(`${url}/api/operator/jobs/${job.id}/context?limit=50`, { headers: auth });
      const afterPage = (await after.json()) as {
        reply: { excerpt: string; lane: string; source: string }[];
      };
      expect(afterPage.reply.some((b) => b.excerpt === "pong from desk" && b.lane === "assistant" && b.source === "reply")).toBe(true);
      const sseRes = await sse;
      expect(sseRes.status).toBe(200);
      expect(await sseRes.text()).toContain("pong from desk");
    });
  });

  test("context lists client tools; complete can emit a tool_use turn", async () => {
    await withSrv(async (url, engine) => {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const cookie = cookieFrom(login);
      const auth = { cookie };

      const job = await engine.create({
        protocol: "anthropic_messages",
        stream: true,
        rawBody: new Uint8Array(),
        headers: {},
        normalized: emptyNormalizedRequest({
          stream: true,
          tools: [{ kind: "anthropic_tool_use", name: "Bash", vendorRaw: {} }],
          messages: [{ role: "user", parts: [{ type: "text", text: "list files" }] }],
        }),
      });
      const sse = fetch(`${url}/debug/jobs/${job.id}/stream`);
      await Bun.sleep(40);

      const ctx = await fetch(`${url}/api/operator/jobs/${job.id}/context?limit=20`, { headers: auth });
      const page = (await ctx.json()) as { tools: { name: string; template: string }[] };
      expect(page.tools.some((t) => t.name === "Bash" && t.template.includes("command"))).toBe(true);

      const denied = await fetch(`${url}/api/operator/jobs/${job.id}/complete`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ tools: [{ name: "Bash", input: '{"command":""}' }] }),
      });
      expect(denied.status).toBe(400);

      const done = await fetch(`${url}/api/operator/jobs/${job.id}/complete`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          text: "listing",
          tools: [{ name: "Bash", input: { command: "ls" } }],
        }),
      });
      expect(done.status).toBe(200);
      const out = (await done.json()) as { stopReason: string; blocks: { type: string; name?: string }[] };
      expect(out.stopReason).toBe("tool_use");
      expect(out.blocks.some((b) => b.type === "tool_use" && b.name === "Bash")).toBe(true);
      const sseRes = await sse;
      expect(await sseRes.text()).toContain('"name":"Bash"');
    });
  });
});
