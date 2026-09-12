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

function cookieFrom(res: Response, name: string): string {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  return all.find((s) => s.toLowerCase().startsWith(`${name}=`))?.split(";")[0] ?? "";
}

describe("desk owner isolation", () => {
  test("named keys land on the owner's desk; guests land on the site desk", async () => {
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "password1";
    conf.auth.apiKeys = [{ label: "guest", key: "sk-carbon-local" }];
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-own-")));
    await ensureBootstrapAdmin(conf, db);
    const engine = new JobEngine(conf, db);
    const app = createApp(conf, { engine, db });
    const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    const url = `http://127.0.0.1:${handle.port}`;
    try {
      const reg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ada", password: "password1" }),
      });
      expect(reg.status).toBe(201);
      const ada = (await reg.json()) as { user: { canReply: boolean }; apiKey: string };
      expect(ada.user.canReply).toBe(true);
      const adaCookie = cookieFrom(reg, "carbon_user");

      const ping = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ada.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "ada desk" }],
        }),
      });
      expect(ping.status).toBe(200);
      await ping.body?.cancel();

      const guest = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "sk-carbon-local",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "site desk" }],
        }),
      });
      expect(guest.status).toBe(200);
      await guest.body?.cancel();

      const adaJobs = (await (await fetch(`${url}/api/operator/jobs`, { headers: { cookie: adaCookie } })).json()) as {
        jobs: { lastUserPreview?: string; ownerId?: string }[];
      };
      expect(adaJobs.jobs.some((j) => j.lastUserPreview?.includes("ada desk"))).toBe(true);
      expect(adaJobs.jobs.some((j) => j.lastUserPreview?.includes("site desk"))).toBe(false);

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const adminCookie = cookieFrom(login, "carbon_user");
      const adminJobs = (await (
        await fetch(`${url}/api/operator/jobs`, { headers: { cookie: adminCookie } })
      ).json()) as { jobs: { lastUserPreview?: string }[] };
      expect(adminJobs.jobs.some((j) => j.lastUserPreview?.includes("site desk"))).toBe(true);
      expect(adminJobs.jobs.some((j) => j.lastUserPreview?.includes("ada desk"))).toBe(false);

      const adaJobId = engine.list().find((j) => j.lastUserPreview.includes("ada desk"))!.id;
      const forbidden = await fetch(`${url}/api/operator/jobs/${adaJobId}`, { headers: { cookie: adminCookie } });
      expect(forbidden.status).toBe(404);
    } finally {
      handle.stop();
      engine.stop();
      db.close();
    }
  });
});
