import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { ensureBootstrapAdmin, resetBootstrapIfRequested } from "../auth/bootstrap.ts";
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
  test("GET /account and /admin redirect to the console", async () => {
    await withSrv(async (url) => {
      const account = await fetch(`${url}/account`, { redirect: "manual" });
      expect(account.status).toBe(302);
      expect(account.headers.get("location") ?? "").toContain("/console");
      const admin = await fetch(`${url}/admin`, { redirect: "manual" });
      expect(admin.status).toBe(302);
      expect(admin.headers.get("location") ?? "").toContain("/console?view=users");
      const page = await fetch(`${url}/console`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Console");
    });
  });

  test("superadmin can set site name and public origin", async () => {
    await withSrv(async (url) => {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      expect(login.status).toBe(200);
      const cookie = cookieFrom(login);
      const denied = await fetch(`${url}/api/admin/settings`);
      expect(denied.status).toBe(403);
      const patched = await fetch(`${url}/api/admin/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Desk",
          nameZh: "工作台",
          publicOrigin: "https://ai.example",
          defaultDisplay: "Desk Model",
        }),
      });
      expect(patched.status).toBe(200);
      const body = (await patched.json()) as { name: string; publicOrigin: string; defaultDisplay: string };
      expect(body.name).toBe("Desk");
      expect(body.publicOrigin).toBe("https://ai.example");
      const home = await fetch(`${url}/`);
      expect(await home.text()).toContain("Desk");
      const connect = await fetch(`${url}/api/me/connect`, { headers: { cookie } });
      const info = (await connect.json()) as { endpoint: string; openaiEndpoint: string; siteName: string; displayName: string };
      expect(info.endpoint).toBe("https://ai.example");
      expect(info.openaiEndpoint).toBe("https://ai.example/v1");
      expect(info.siteName).toBe("Desk");
      expect(info.displayName).toBe("Desk Model");
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
      expect(created.user.canReply).toBe(true);
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

      const aliceCookie = cookieFrom(reg);
      const jobs = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: aliceCookie } });
      expect(jobs.status).toBe(200);
      const listed = (await jobs.json()) as { jobs: { clientLabel: string; callerLabel?: string }[] };
      expect(listed.jobs.some((j) => j.clientLabel === "alice" || j.callerLabel === "alice")).toBe(true);

      const adminLogin = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      expect(adminLogin.status).toBe(200);
      const adminCookie = cookieFrom(adminLogin);
      const adminJobs = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: adminCookie } });
      const adminListed = (await adminJobs.json()) as { jobs: { clientLabel: string }[] };
      expect(adminListed.jobs.some((j) => j.clientLabel === "alice")).toBe(false);

      const minted = await fetch(`${url}/api/me/keys`, {
        method: "POST",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ label: "tmp" }),
      });
      expect(minted.status).toBe(201);
      const key = (await minted.json()) as { id: string; apiKey: string };
      const removed = await fetch(`${url}/api/me/keys/${key.id}`, {
        method: "DELETE",
        headers: { cookie: adminCookie },
      });
      expect(removed.status).toBe(200);
      const listedKeys = await fetch(`${url}/api/me/keys`, { headers: { cookie: adminCookie } });
      const keysBody = (await listedKeys.json()) as { keys: { id: string }[] };
      expect(keysBody.keys.some((k) => k.id === key.id)).toBe(false);
      const dead = await fetch(`${url}/v1/models`, {
        headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01" },
      });
      expect(dead.status).toBe(401);
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
      const allowed = await fetch(`${url}/api/operator/jobs`, { headers: { cookie: bobCookie } });
      expect(allowed.status).toBe(200);

      const adminLogin = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      const adminCookie = cookieFrom(adminLogin);

      const disable = await fetch(`${url}/api/admin/users/${bob.user.id}`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      });
      expect(disable.status).toBe(200);

      const kicked = await fetch(`${url}/api/me`, { headers: { cookie: bobCookie } });
      expect(kicked.status).toBe(401);

      const models = await fetch(`${url}/v1/models`, {
        headers: { "x-api-key": bob.apiKey, "anthropic-version": "2023-06-01" },
      });
      expect(models.status).toBe(401);
    });
  });

  test("login cookie still works after a new process on the same db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-sess-"));
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.operatorToken = "op-token";
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "adminpass";
    const db1 = openDatabase(dir);
    await ensureBootstrapAdmin(conf, db1);
    const engine1 = new JobEngine(conf, db1);
    const app1 = createApp(conf, { engine: engine1, db: db1 });
    const handle1 = listen(app1.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    let cookie = "";
    try {
      const login = await fetch(`http://127.0.0.1:${handle1.port}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "adminpass" }),
      });
      expect(login.status).toBe(200);
      cookie = cookieFrom(login);
      expect(cookie.startsWith("carbon_user=")).toBe(true);
      const me = await fetch(`http://127.0.0.1:${handle1.port}/api/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
    } finally {
      handle1.stop();
      engine1.stop();
      db1.close();
    }
    const db2 = openDatabase(dir);
    const engine2 = new JobEngine(conf, db2);
    const app2 = createApp(conf, { engine: engine2, db: db2 });
    const handle2 = listen(app2.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    try {
      const me = await fetch(`http://127.0.0.1:${handle2.port}/api/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
      const body = (await me.json()) as { user: { username: string } };
      expect(body.user.username).toBe("admin");
      const out = await fetch(`http://127.0.0.1:${handle2.port}/api/auth/logout`, {
        method: "POST",
        headers: { cookie },
      });
      expect(out.status).toBe(200);
      const after = await fetch(`http://127.0.0.1:${handle2.port}/api/me`, { headers: { cookie } });
      expect(after.status).toBe(401);
    } finally {
      handle2.stop();
      engine2.stop();
      db2.close();
    }
  });

  test("reset-bootstrap file updates the superadmin password once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-reset-"));
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.server.dataDir = dir;
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "oldpass12";
    const db = openDatabase(dir);
    await ensureBootstrapAdmin(conf, db);
    writeFileSync(join(dir, "reset-bootstrap"), "newpass99\n", "utf8");
    expect(await resetBootstrapIfRequested(conf, db)).toBe(true);
    const user = db.users.getByUsername("admin");
    expect(user).toBeTruthy();
    expect(await Bun.password.verify("newpass99", user!.password_hash)).toBe(true);
    expect(await resetBootstrapIfRequested(conf, db)).toBe(false);
    db.close();
  });

  test("empty database uses setup wizard; CC Switch href binds the issued key", async () => {
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.operatorToken = "op-token";
    conf.auth.bootstrapPassword = "";
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-setup-")));
    await ensureBootstrapAdmin(conf, db);
    const engine = new JobEngine(conf, db);
    const app = createApp(conf, { engine, db });
    const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    const url = `http://127.0.0.1:${handle.port}`;
    try {
      const status = await fetch(`${url}/api/setup/status`);
      expect(status.status).toBe(200);
      expect(((await status.json()) as { needsSetup: boolean }).needsSetup).toBe(true);

      const blocked = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password1" }),
      });
      expect(blocked.status).toBe(403);

      const setup = await fetch(`${url}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "root", password: "password1" }),
      });
      expect(setup.status).toBe(201);
      const created = (await setup.json()) as { user: { role: string; canReply: boolean }; apiKey: string };
      expect(created.user.role).toBe("superadmin");
      expect(created.user.canReply).toBe(true);
      const cookie = cookieFrom(setup);

      const again = await fetch(`${url}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "root2", password: "password1" }),
      });
      expect(again.status).toBe(409);

      const cc = await fetch(`${url}/api/me/cc-switch`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ apiKey: created.apiKey }),
      });
      expect(cc.status).toBe(200);
      const body = (await cc.json()) as { href: string; endpoint: string };
      expect(body.href.startsWith("ccswitch://v1/import?")).toBe(true);
      expect(body.endpoint.endsWith("/v1")).toBe(false);
      const qs = new URLSearchParams(body.href.slice("ccswitch://v1/import?".length));
      expect(qs.get("apiKey")).toBe(created.apiKey);
      expect(qs.get("app")).toBe("claude");

      const minted = await fetch(`${url}/api/me/keys`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ label: "cc" }),
      });
      expect(minted.status).toBe(201);
      const key = (await minted.json()) as { id: string; apiKey: string; prefix: string };
      expect(key.id.startsWith("key_")).toBe(true);
      expect(key.apiKey.startsWith("sk-carbon-")).toBe(true);
      const listed = await fetch(`${url}/api/me/keys`, { headers: { cookie } });
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as { keys: { id: string; apiKey?: string }[] };
      expect(listedBody.keys.find((k) => k.id === key.id)?.apiKey).toBe(key.apiKey);
      const ccMinted = await fetch(`${url}/api/me/cc-switch`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key.apiKey }),
      });
      expect(ccMinted.status).toBe(200);
      expect(((await ccMinted.json()) as { href: string }).href).toContain(key.apiKey);
    } finally {
      handle.stop();
      engine.stop();
      db.close();
    }
  });
});
