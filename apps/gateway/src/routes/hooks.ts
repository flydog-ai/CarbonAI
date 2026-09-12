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

  return app;
}
