import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { JobEngine } from "../job/engine.ts";
import { listen } from "../listen.ts";

function pickPort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function withSrv(fn: (url: string) => Promise<void>): Promise<void> {
  const conf: Config = structuredClone(DEFAULT_CONFIG);
  conf.auth.operatorToken = "op-token";
  conf.auth.bootstrapUsername = "admin";
  conf.auth.bootstrapPassword = "adminpass";
  conf.auth.apiKeys = [{ label: "legacy", key: "sk-legacy" }];
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-auth-")));
  await ensureBootstrapAdmin(conf, db);
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine, db });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

describe("user accounts phase 1", () => {
  test("GET /account and /admin are html", async () => {
    await withSrv(async (url) => {
      const account = await fetch(`${url}/account`);
      expect(account.status).toBe(200);
      expect(account.headers.get("content-type") ?? "").toContain("text/html");
      expect(await account.text()).toContain("Account");
      const admin = await fetch(`${url}/admin`);
      expect(admin.status).toBe(200);
      expect(await admin.text()).toContain("Users");
    });
  });

  test("register issues a key; key authenticates /v1/models; username shows on jobs", async () => {
    await withSrv(async (url) => {
      const reg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password1" }),
      });
      expect(reg.status).toBe(201);
      const created = (await reg.json()) as { user: { username: string; canReply: boolean }; apiKey: string };
      expect(created.user.username).toBe("alice");
      expect(created.user.canReply).toBe(false);
      expect(created.apiKey.startsWith("sk-carbon-")).toBe(true);

      const models = await fetch(`${url}/v1/models`, {
        headers: { "x-api-key": created.apiKey, "anthropic-version": "2023-06-01" },
      });
      expect(models.status).toBe(200);

      const msg = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": created.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "hi alice" }],
        }),
      });
      expect(msg.status).toBe(200);
      await msg.body?.cancel();

      const adminLogin = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      expect(adminLogin.status).toBe(200);
      const adminCookie = cookieFrom(adminLogin);
      const jobs = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: adminCookie } });
      expect(jobs.status).toBe(200);
      const listed = (await jobs.json()) as { jobs: { clientLabel: string; userId?: string }[] };
      expect(listed.jobs.some((j) => j.clientLabel === "alice")).toBe(true);
    });
  });

  test("can_reply gate and superadmin disable", async () => {
    await withSrv(async (url) => {
      const reg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "bob", password: "password1" }),
      });
      const bob = (await reg.json()) as { user: { id: string }; apiKey: string };
      const bobCookie = cookieFrom(reg);
      const denied = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: bobCookie } });
      expect(denied.status).toBe(403);

      const adminLogin = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      const adminCookie = cookieFrom(adminLogin);
      const grant = await fetch(`${url}/api/admin/users/${bob.user.id}`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ canReply: true }),
      });
      expect(grant.status).toBe(200);

      const allowed = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: bobCookie } });
      expect(allowed.status).toBe(200);

      const disable = await fetch(`${url}/api/admin/users/${bob.user.id}`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      });
      expect(disable.status).toBe(200);

      const models = await fetch(`${url}/v1/models`, {
        headers: { "x-api-key": bob.apiKey, "anthropic-version": "2023-06-01" },
      });
      expect(models.status).toBe(401);
    });
  });
});
