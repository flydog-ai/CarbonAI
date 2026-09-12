import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { wechatSignature } from "../channels/wechat-mp.ts";
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

function sign(token: string, timestamp: string, nonce: string): string {
  return wechatSignature(token, timestamp, nonce);
}

function textXml(from: string, content: string): string {
  return `<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>1</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content></xml>`;
}

async function withSrv(fn: (url: string, engine: JobEngine) => Promise<void>): Promise<void> {
  const conf: Config = structuredClone(DEFAULT_CONFIG);
  conf.auth.bootstrapUsername = "admin";
  conf.auth.bootstrapPassword = "password1";
  conf.site.publicOrigin = "https://ai.example";
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-ch-")));
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

describe("wechat channel", () => {
  test("admin callback url follows public origin; hook verifies and completes a live job", async () => {
    await withSrv(async (url, engine) => {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      expect(login.status).toBe(200);
      const auth = { cookie: cookieFrom(login, "carbon_user") };

      const listed = await fetch(`${url}/api/admin/channels`, { headers: auth });
      expect(listed.status).toBe(200);
      const info = (await listed.json()) as { callbackUrl: string; httpsRequired: boolean; wechat: null };
      expect(info.callbackUrl).toBe("https://ai.example/hooks/wechat");
      expect(info.httpsRequired).toBe(false);
      expect(info.wechat).toBeNull();

      const saved = await fetch(`${url}/api/admin/channels`, {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "wechat_mp",
          appId: "wxapp",
          appSecret: "secret",
          token: "tok",
          enabled: true,
        }),
      });
      expect(saved.status).toBe(200);
      const after = (await saved.json()) as { wechat: { secretSet: boolean; appId: string; enabled: boolean } };
      expect(after.wechat.secretSet).toBe(true);
      expect(after.wechat.appId).toBe("wxapp");
      expect(after.wechat.enabled).toBe(true);
      expect(after.wechat.token).toBe("tok");
      expect(after.wechat.secretPrefix).toContain("••••");
      expect(JSON.stringify(after)).not.toContain("app_secret");
      expect(JSON.stringify(after)).not.toContain('"appSecret"');

      const ts = "1409304348";
      const nonce = "nonce";
      const echo = "ping";
      const ok = await fetch(
        `${url}/hooks/wechat?signature=${sign("tok", ts, nonce)}&timestamp=${ts}&nonce=${nonce}&echostr=${echo}`,
      );
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe(echo);
      const bad = await fetch(
        `${url}/hooks/wechat?signature=${"0".repeat(40)}&timestamp=${ts}&nonce=${nonce}&echostr=${echo}`,
      );
      expect(bad.status).toBe(403);

      const minted = await fetch(`${url}/api/me/channels/bind-code`, { method: "POST", headers: auth });
      expect(minted.status).toBe(200);
      const { code } = (await minted.json()) as { code: string };
      expect(code.startsWith("BIND-")).toBe(true);

      const bind = await fetch(`${url}/hooks/wechat?signature=${sign("tok", ts, nonce)}&timestamp=${ts}&nonce=${nonce}`, {
        method: "POST",
        headers: { "content-type": "text/xml" },
        body: textXml("openid-1", code),
      });
      expect(bind.status).toBe(200);
      expect(await bind.text()).toContain("已绑定");

      const job = await engine.create({
        protocol: "anthropic_messages",
        stream: false,
        rawBody: new TextEncoder().encode("{}"),
        headers: {},
        clientLabel: "G-TEST",
        callerLabel: "G-TEST",
        clientKind: "claude-code",
      });
      expect(job.status).toBe("pending");

      const reply = await fetch(`${url}/hooks/wechat?signature=${sign("tok", ts, nonce)}&timestamp=${ts}&nonce=${nonce}`, {
        method: "POST",
        headers: { "content-type": "text/xml" },
        body: textXml("openid-1", "hello from wechat"),
      });
      expect(reply.status).toBe(200);
      expect(await reply.text()).toContain("已回复");
      expect(engine.get(job.id).status).toBe("completed");
    });
  });

  test("unbound openid does not complete a job", async () => {
    await withSrv(async (url, engine) => {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const auth = { cookie: cookieFrom(login, "carbon_user") };
      await fetch(`${url}/api/admin/channels`, {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ token: "tok", enabled: true }),
      });
      const job = await engine.create({
        protocol: "anthropic_messages",
        stream: false,
        rawBody: new TextEncoder().encode("x"),
        headers: {},
      });
      const ts = "1";
      const nonce = "n";
      const res = await fetch(`${url}/hooks/wechat?signature=${sign("tok", ts, nonce)}&timestamp=${ts}&nonce=${nonce}`, {
        method: "POST",
        body: textXml("stranger", "hello"),
      });
      expect(await res.text()).toContain("尚未绑定");
      expect(engine.get(job.id).status).toBe("pending");
    });
  });
});
