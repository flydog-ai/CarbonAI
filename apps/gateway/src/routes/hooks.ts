import { Hono } from "hono";
import type { ChannelHub } from "../channels/hub.ts";

export function hookRoutes(hub: ChannelHub): Hono {
  const app = new Hono();

  app.get("/hooks/wechat", (c) => {
    const echo = hub.verifyGet({
      signature: c.req.query("signature"),
      timestamp: c.req.query("timestamp"),
      nonce: c.req.query("nonce"),
      echostr: c.req.query("echostr"),
    });
    if (echo === undefined) return c.text("forbidden", 403);
    return c.text(echo);
  });

  app.post("/hooks/wechat", async (c) => {
    const raw = await c.req.text();
    const xml = await hub.handlePost(
      {
        signature: c.req.query("signature"),
        timestamp: c.req.query("timestamp"),
        nonce: c.req.query("nonce"),
        msg_signature: c.req.query("msg_signature"),
        encrypt_type: c.req.query("encrypt_type"),
      },
      raw,
    );
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
  });

  app.post("/hooks/feishu", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const out = await hub.handleFeishu(body);
    return c.json(out);
  });

  app.post("/hooks/dingtalk", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const out = await hub.handleDingTalk(
      { timestamp: c.req.header("timestamp") ?? undefined, sign: c.req.header("sign") ?? undefined },
      body,
    );
    return c.json(out);
  });

  return app;
}
