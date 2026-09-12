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

function homeKey(html: string): string {
  const m = /id="home-key">([^<]+)/.exec(html);
  return m?.[1]?.trim() ?? "";
}

async function postMessage(url: string, apiKey: string, text: string): Promise<void> {
  const ping = await fetch(`${url}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "carbon-default",
      max_tokens: 16,
      stream: true,
      messages: [{ role: "user", content: text }],
    }),
  });
  expect(ping.status).toBe(200);
  await ping.body?.cancel();
}

async function jobPreviews(url: string, cookie: string): Promise<string[]> {
  const body = (await (await fetch(`${url}/api/operator/jobs`, { headers: { cookie } })).json()) as {
    jobs: { lastUserPreview?: string }[];
  };
  return body.jobs.map((j) => j.lastUserPreview ?? "");
}

describe("desk owner isolation", () => {
  test("named keys land on the owner's desk; homepage and guests land on the site desk", async () => {
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
      const home = await fetch(`${url}/`);
      const siteKey = homeKey(await home.text());
      expect(siteKey).toBe(db.users.siteDeskKeyPlain());
      expect(siteKey.startsWith("sk-carbon-")).toBe(true);
      expect(siteKey).not.toBe("sk-carbon-local");

      const reg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ada", password: "password1" }),
      });
      expect(reg.status).toBe(201);
      const ada = (await reg.json()) as { user: { canReply: boolean }; apiKey: string };
      expect(ada.user.canReply).toBe(true);
      const adaCookie = cookieFrom(reg, "carbon_user");
      expect(ada.apiKey).not.toBe(siteKey);

      const extra = await fetch(`${url}/api/me/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adaCookie },
        body: JSON.stringify({ label: "share" }),
      });
      expect(extra.status).toBe(201);
      const adaExtra = (await extra.json()) as { apiKey: string };

      const bobReg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "bob", password: "password1" }),
      });
      expect(bobReg.status).toBe(201);
      const bob = (await bobReg.json()) as { apiKey: string };
      const bobCookie = cookieFrom(bobReg, "carbon_user");

      await postMessage(url, ada.apiKey, "ada desk");
      await postMessage(url, adaExtra.apiKey, "ada extra");
      await postMessage(url, bob.apiKey, "bob desk");
      await postMessage(url, "sk-carbon-local", "toml guest");
      await postMessage(url, siteKey, "home desk");

      const adaPreviews = await jobPreviews(url, adaCookie);
      expect(adaPreviews.some((p) => p.includes("ada desk"))).toBe(true);
      expect(adaPreviews.some((p) => p.includes("ada extra"))).toBe(true);
      expect(adaPreviews.some((p) => p.includes("bob desk"))).toBe(false);
      expect(adaPreviews.some((p) => p.includes("toml guest"))).toBe(false);
      expect(adaPreviews.some((p) => p.includes("home desk"))).toBe(false);

      const bobPreviews = await jobPreviews(url, bobCookie);
      expect(bobPreviews.some((p) => p.includes("bob desk"))).toBe(true);
      expect(bobPreviews.some((p) => p.includes("ada desk"))).toBe(false);
      expect(bobPreviews.some((p) => p.includes("ada extra"))).toBe(false);
      expect(bobPreviews.some((p) => p.includes("home desk"))).toBe(false);

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const adminCookie = cookieFrom(login, "carbon_user");
      const adminPreviews = await jobPreviews(url, adminCookie);
      expect(adminPreviews.some((p) => p.includes("toml guest"))).toBe(true);
      expect(adminPreviews.some((p) => p.includes("home desk"))).toBe(true);
      expect(adminPreviews.some((p) => p.includes("ada desk"))).toBe(false);
      expect(adminPreviews.some((p) => p.includes("ada extra"))).toBe(false);
      expect(adminPreviews.some((p) => p.includes("bob desk"))).toBe(false);

      const adaJobId = engine.list().find((j) => j.lastUserPreview.includes("ada extra"))!.id;
      const forbidden = await fetch(`${url}/api/operator/jobs/${adaJobId}`, { headers: { cookie: adminCookie } });
      expect(forbidden.status).toBe(404);
      const bobPeek = await fetch(`${url}/api/operator/jobs/${adaJobId}`, { headers: { cookie: bobCookie } });
      expect(bobPeek.status).toBe(404);
    } finally {
      handle.stop();
      engine.stop();
      db.close();
    }
  });
});
