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
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ok"),
  });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function cookieFrom(res: Response, name: string): string {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const hit = all.find((s) => s.toLowerCase().startsWith(`${name}=`));
  return hit?.split(";")[0] ?? "";
}

function homeKey(html: string): string {
  const m = /id="home-key">([^<]+)/.exec(html);
  return m?.[1]?.trim() ?? "";
}

async function withSrv(fn: (url: string) => Promise<void>): Promise<void> {
  const conf: Config = structuredClone(DEFAULT_CONFIG);
  conf.auth.bootstrapUsername = "admin";
  conf.auth.bootstrapPassword = "password1";
  conf.auth.apiKeys = [{ label: "Claude Code", key: "sk-carbon-local" }];
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-vid-")));
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

describe("guest visitors", () => {
  test("homepage mints a stable per-browser key and desk shows guest id plus client kind", async () => {
    await withSrv(async (url) => {
      const first = await fetch(`${url}/`);
      expect(first.status).toBe(200);
      const vid = cookieFrom(first, "carbon_vid");
      expect(vid.startsWith("carbon_vid=vis_")).toBe(true);
      const html1 = await first.text();
      const key1 = homeKey(html1);
      expect(key1.startsWith("sk-carbon-")).toBe(true);
      expect(key1).not.toBe("sk-carbon-local");
      expect(html1).toContain("guest key for this browser");

      const again = await fetch(`${url}/`, { headers: { cookie: vid } });
      expect(homeKey(await again.text())).toBe(key1);

      const other = await fetch(`${url}/`, { headers: { "user-agent": "Mozilla/5.0 Firefox/120" } });
      const key2 = homeKey(await other.text());
      expect(key2.startsWith("sk-carbon-")).toBe(true);
      expect(key2).not.toBe(key1);

      const models = await fetch(`${url}/v1/models`, {
        headers: { "x-api-key": key1, "anthropic-version": "2023-06-01", "user-agent": "claude-cli/1.0.0" },
      });
      expect(models.status).toBe(200);

      const sse = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key1,
          "anthropic-version": "2023-06-01",
          "user-agent": "claude-cli/1.0.0",
        },
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "hello guest" }],
        }),
      });
      expect(sse.status).toBe(200);
      await sse.body?.cancel();

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      expect(login.status).toBe(200);
      const auth = { cookie: cookieFrom(login, "carbon_user") };

      const jobs = await fetch(`${url}/api/operator/jobs`, { headers: auth });
      expect(jobs.status).toBe(200);
      const listed = (await jobs.json()) as {
        jobs: {
          callerLabel?: string;
          clientKind?: string;
          clientIp?: string;
          presence?: string;
          lastUserPreview?: string;
          keyPrefix?: string;
        }[];
      };
      const job = listed.jobs.find((j) => j.lastUserPreview?.includes("hello guest"));
      expect(job?.callerLabel?.startsWith("G-")).toBe(true);
      expect(job?.clientKind).toBe("claude-code");
      expect(job?.keyPrefix?.startsWith("sk-carbon-")).toBe(true);
      expect(job?.clientIp).toBe("127.0.0.1");
      expect(job?.presence).toBeTruthy();

      const callers = await fetch(`${url}/api/operator/callers`, { headers: auth });
      expect(callers.status).toBe(200);
      const body = (await callers.json()) as {
        callers: { label: string; kind: string; clientKind?: string; presence: string }[];
      };
      expect(body.callers.some((c) => c.kind === "guest" && c.label.startsWith("G-") && c.clientKind === "claude-code")).toBe(true);

      const otherCli = await fetch(`${url}/v1/models`, {
        headers: {
          "x-api-key": key1,
          "anthropic-version": "2023-06-01",
          "user-agent": "codex-cli/0.44",
        },
      });
      expect(otherCli.status).toBe(200);
      const callers2 = await fetch(`${url}/api/operator/callers`, { headers: auth });
      const body2 = (await callers2.json()) as { callers: { label: string; clientKind?: string }[] };
      expect(body2.callers.some((c) => c.clientKind === "claude-code")).toBe(true);
    });
  });

  test("shared toml key still authenticates and is tagged as a guest", async () => {
    await withSrv(async (url) => {
      const models = await fetch(`${url}/v1/models`, {
        headers: {
          "x-api-key": "sk-carbon-local",
          "anthropic-version": "2023-06-01",
          "user-agent": "codex-cli/0.44",
        },
      });
      expect(models.status).toBe(200);
      const sse = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "sk-carbon-local",
          "anthropic-version": "2023-06-01",
          "user-agent": "codex-cli/0.44",
        },
        body: JSON.stringify({
          model: "carbon-default",
          max_tokens: 16,
          stream: true,
          messages: [{ role: "user", content: "toml guest" }],
        }),
      });
      expect(sse.status).toBe(200);
      await sse.body?.cancel();

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const auth = { cookie: cookieFrom(login, "carbon_user") };
      const callers = await fetch(`${url}/api/operator/callers`, { headers: auth });
      const body = (await callers.json()) as { callers: { kind: string; clientKind?: string }[] };
      expect(body.callers.some((c) => c.kind === "guest" && c.clientKind === "codex")).toBe(true);
    });
  });
});
