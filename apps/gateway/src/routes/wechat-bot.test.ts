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
});
