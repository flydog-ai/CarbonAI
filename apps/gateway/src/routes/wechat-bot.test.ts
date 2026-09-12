import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { ChannelHub } from "../channels/hub.ts";
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("wechat iLink bot", () => {
  test("QR confirm stores bot and inbound text completes a job", async () => {
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "password1";
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-bot-")));
    await ensureBootstrapAdmin(conf, db);
    const engine = new JobEngine(conf, db);

    let confirmed = false;
    const inbound: Array<{ from_user_id: string; message_type: number; item_list: unknown[] }> = [];
    const href = (url: string | URL | Request): string => {
      if (typeof url === "string") return url;
      if (url instanceof URL) return url.href;
      if (url instanceof Request) return url.url;
      return String(url);
    };
    const ilinkFetch: typeof fetch = async (url) => {
      const u = href(url as string | URL | Request);
      if (u.includes("get_bot_qrcode")) return json({ qrcode: "qr-secret", qrcode_img_content: "https://qr.example/p.png" });
      if (u.includes("get_qrcode_status")) {
        confirmed = true;
        return json({
          status: "confirmed",
          bot_token: "bot-token",
          ilink_bot_id: "ilink-bot-1",
          baseurl: "https://ilink.test",
          ilink_user_id: "wx-user-1",
        });
      }
      if (u.includes("getupdates")) {
        const msgs = inbound.splice(0, inbound.length);
        return json({ ret: 0, msgs, get_updates_buf: "cursor-1" });
      }
      if (u.includes("sendmessage")) return json({ ret: 0 });
      return new Response("missing", { status: 404 });
    };

    const hub = new ChannelHub(conf, db, engine, Date.now, fetch, ilinkFetch);
    const app = createApp(conf, { engine, db, channels: hub });
    const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    const url = `http://127.0.0.1:${handle.port}`;
    try {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const auth = { cookie: cookieFrom(login, "carbon_user") };

      const start = await fetch(`${url}/api/admin/channels/wechat-bot/qr`, { method: "POST", headers: auth });
      expect(start.status).toBe(200);
      const { sessionKey, qrcodeUrl, qrImage } = (await start.json()) as {
        sessionKey: string;
        qrcodeUrl: string;
        qrImage?: string;
      };
      expect(qrcodeUrl).toContain("qr.example");
      expect(qrImage?.startsWith("data:image/png")).toBe(true);

      const polled = await fetch(
        `${url}/api/admin/channels/wechat-bot/qr?sessionKey=${encodeURIComponent(sessionKey)}`,
        { headers: auth },
      );
      expect(polled.status).toBe(200);
      const done = (await polled.json()) as { status: string; connected?: boolean };
      expect(confirmed).toBe(true);
      expect(done.status).toBe("confirmed");
      expect(done.connected).toBe(true);

      const listed = await fetch(`${url}/api/admin/channels`, { headers: auth });
      const info = (await listed.json()) as { wechatBot: { connected: boolean; botId: string } };
      expect(info.wechatBot.connected).toBe(true);
      expect(info.wechatBot.botId).toBe("ilink-bot-1");

      const job = await engine.create({
        protocol: "anthropic_messages",
        stream: false,
        rawBody: new TextEncoder().encode("{}"),
        headers: {},
        callerLabel: "G-BOT",
      });
      inbound.push({
        from_user_id: "wx-user-1",
        message_type: 1,
        item_list: [{ type: 1, text_item: { text: "reply via bot" } }],
      });
      const until = Date.now() + 4000;
      while (Date.now() < until && engine.get(job.id).status !== "completed") {
        await Bun.sleep(50);
      }
      expect(engine.get(job.id).status).toBe("completed");
    } finally {
      hub.stop();
      handle.stop();
      engine.stop();
      await Bun.sleep(20);
      db.close();
    }
  });

  test("each user scans their own bot; inbound completes only the owner's job", async () => {
    const conf: Config = structuredClone(DEFAULT_CONFIG);
    conf.auth.bootstrapUsername = "admin";
    conf.auth.bootstrapPassword = "password1";
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-bot2-")));
    await ensureBootstrapAdmin(conf, db);
    const engine = new JobEngine(conf, db);

    let qrN = 0;
    const inbound: Record<string, Array<{ from_user_id: string; message_type: number; item_list: unknown[] }>> = {
      "bot-token-1": [],
      "bot-token-2": [],
    };
    const href = (url: string | URL | Request): string => {
      if (typeof url === "string") return url;
      if (url instanceof URL) return url.href;
      if (url instanceof Request) return url.url;
      return String(url);
    };
    const bearer = (init?: RequestInit): string => {
      const h = init?.headers;
      if (!h) return "";
      if (h instanceof Headers) return h.get("Authorization") ?? "";
      return (h as Record<string, string>).Authorization ?? "";
    };
    const ilinkFetch: typeof fetch = async (url, init) => {
      const u = href(url as string | URL | Request);
      if (u.includes("get_bot_qrcode")) {
        qrN += 1;
        return json({ qrcode: `qr-${qrN}`, qrcode_img_content: `https://qr.example/${qrN}.png` });
      }
      if (u.includes("get_qrcode_status")) {
        const n = u.includes("qr-2") ? 2 : 1;
        return json({
          status: "confirmed",
          bot_token: `bot-token-${n}`,
          ilink_bot_id: `ilink-bot-${n}`,
          baseurl: "https://ilink.test",
          ilink_user_id: `wx-user-${n}`,
        });
      }
      if (u.includes("getupdates")) {
        const token = bearer(init).includes("bot-token-2") ? "bot-token-2" : "bot-token-1";
        const q = inbound[token] ?? [];
        const msgs = q.splice(0, q.length);
        return json({ ret: 0, msgs, get_updates_buf: "cursor-1" });
      }
      if (u.includes("sendmessage")) return json({ ret: 0 });
      return new Response("missing", { status: 404 });
    };

    const hub = new ChannelHub(conf, db, engine, Date.now, fetch, ilinkFetch);
    const app = createApp(conf, { engine, db, channels: hub });
    const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
    const url = `http://127.0.0.1:${handle.port}`;
    try {
      const login = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password1" }),
      });
      const adminAuth = { cookie: cookieFrom(login, "carbon_user") };
      const adminStart = await fetch(`${url}/api/me/channels/wechat-bot/qr`, { method: "POST", headers: adminAuth });
      const adminQr = (await adminStart.json()) as { sessionKey: string };
      const adminDone = await fetch(
        `${url}/api/me/channels/wechat-bot/qr?sessionKey=${encodeURIComponent(adminQr.sessionKey)}`,
        { headers: adminAuth },
      );
      expect(((await adminDone.json()) as { status: string }).status).toBe("confirmed");

      const reg = await fetch(`${url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ada", password: "password1" }),
      });
      const ada = (await reg.json()) as { apiKey: string };
      const adaAuth = { cookie: cookieFrom(reg, "carbon_user") };
      const adaStart = await fetch(`${url}/api/me/channels/wechat-bot/qr`, { method: "POST", headers: adaAuth });
      const adaQr = (await adaStart.json()) as { sessionKey: string };
      const adaDone = await fetch(
        `${url}/api/me/channels/wechat-bot/qr?sessionKey=${encodeURIComponent(adaQr.sessionKey)}`,
        { headers: adaAuth },
      );
      expect(((await adaDone.json()) as { status: string }).status).toBe("confirmed");

      const listedAda = (await (await fetch(`${url}/api/me/channels`, { headers: adaAuth })).json()) as {
        wechatBot: { botId: string; connected: boolean };
      };
      const listedAdmin = (await (await fetch(`${url}/api/me/channels`, { headers: adminAuth })).json()) as {
        wechatBot: { botId: string };
      };
      expect(listedAda.wechatBot.connected).toBe(true);
      expect(listedAda.wechatBot.botId).toBe("ilink-bot-2");
      expect(listedAdmin.wechatBot.botId).toBe("ilink-bot-1");
      expect(listedAda.wechatBot.botId).not.toBe(listedAdmin.wechatBot.botId);

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
          messages: [{ role: "user", content: "ada bot job" }],
        }),
      });
      expect(ping.status).toBe(200);
      const adaJob = engine.list().find((j) => j.lastUserPreview.includes("ada bot job"))!;

      inbound["bot-token-1"]!.push({
        from_user_id: "wx-user-1",
        message_type: 1,
        item_list: [{ type: 1, text_item: { text: "admin should not take this" } }],
      });
      await Bun.sleep(200);
      expect(engine.get(adaJob.id).status).toBe("pending");

      inbound["bot-token-2"]!.push({
        from_user_id: "wx-user-2",
        message_type: 1,
        item_list: [{ type: 1, text_item: { text: "ada via her bot" } }],
      });
      const until = Date.now() + 4000;
      while (Date.now() < until && engine.get(adaJob.id).status !== "completed") {
        await Bun.sleep(50);
      }
      expect(engine.get(adaJob.id).status).toBe("completed");
    } finally {
      hub.stop();
      handle.stop();
      engine.stop();
      await Bun.sleep(20);
      db.close();
    }
  });
});
