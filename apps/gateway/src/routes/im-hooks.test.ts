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

describe("im hooks", () => {
  test("feishu url verification and telegram config save", async () => {
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "password1";
    conf.site.publicOrigin = "https://ai.example";
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-im-")));
    await ensureBootstrapAdmin(conf, db);
    const engine = new JobEngine(conf, db);
    const app = createApp(conf, { engine, db });
    const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    const url = `http://127.0.0.1:${handle.port}`;
    try {
      const challenge = await fetch(`${url}/hooks/feishu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "url_verification", challenge: "ping-fs" }),
      });
      expect(challenge.status).toBe(200);
      expect(((await challenge.json()) as { challenge: string }).challenge).toBe("ping-fs");

      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const auth = { cookie: cookieFrom(login, "carbon_user") };
      const saved = await fetch(`${url}/api/admin/channels`, {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ kind: "telegram", token: "123:abc" }),
      });
      expect(saved.status).toBe(200);
      const body = (await saved.json()) as { telegram: { enabled: boolean; tokenSet: boolean }; feishuCallback: string };
      expect(body.telegram.tokenSet).toBe(true);
      expect(body.telegram.enabled).toBe(false);
      expect(body.feishuCallback).toBe("https://ai.example/hooks/feishu");
    } finally {
      handle.stop();
      engine.stop();
      db.close();
    }
  });
});
