import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  SETTINGS_KEYS,
  applySettingsKv,
  normalizePublicOrigin,
  publicSettings,
  type Config,
} from "@carbon-ai/config";
import type { CarbonDb } from "@carbon-ai/db";
import { USER_COOKIE, UserSessions } from "../auth/user-session.ts";
import type { ChannelHub } from "../channels/hub.ts";
import { preferLoopbackOrigin } from "../home/cc-switch.ts";
import { readJsonCapped } from "../http/read-json-capped.ts";

export function adminRoutes(cfg: Config, db: CarbonDb, sessions: UserSessions, channels?: ChannelHub): Hono {
  const app = new Hono();

  const superadmin = (c: Context) => {
    const s = sessions.get(getCookie(c, USER_COOKIE));
    if (!s) return undefined;
    const user = db.users.getById(s.userId);
    if (!user || user.disabled || user.role !== "superadmin") return undefined;
    return user;
  };

  app.get("/admin", (c) => c.redirect("/console?view=users"));
  app.get("/admin/", (c) => c.redirect("/console?view=users"));

  app.get("/api/admin/settings", (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    return c.json({
      ...publicSettings(cfg),
      autoOrigin: preferLoopbackOrigin(c.req.url),
    });
  });

  app.patch("/api/admin/settings", async (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    const body = (await readJsonCapped(c.req.raw, 4096)) as {
      name?: string;
      nameZh?: string;
      publicOrigin?: string;
      defaultDisplay?: string;
    };
    const kv: Record<string, string> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name.length < 1 || name.length > 64) return c.json({ error: "site name must be 1-64 characters" }, 400);
      kv[SETTINGS_KEYS.name] = name;
    }
    if (typeof body.nameZh === "string") {
      const nameZh = body.nameZh.trim();
      if (nameZh.length < 1 || nameZh.length > 64) return c.json({ error: "site name (zh) must be 1-64 characters" }, 400);
      kv[SETTINGS_KEYS.nameZh] = nameZh;
    }
    if (typeof body.publicOrigin === "string") {
      const origin = normalizePublicOrigin(body.publicOrigin);
      if (typeof origin !== "string") return c.json({ error: origin.error }, 400);
      kv[SETTINGS_KEYS.publicOrigin] = origin;
    }
    if (typeof body.defaultDisplay === "string") {
      const display = body.defaultDisplay.trim();
      if (display.length < 1 || display.length > 64) return c.json({ error: "display name must be 1-64 characters" }, 400);
      kv[SETTINGS_KEYS.defaultDisplay] = display;
    }
    for (const [key, value] of Object.entries(kv)) db.settings.set(key, value);
    applySettingsKv(cfg, kv);
    return c.json({
      ...publicSettings(cfg),
      autoOrigin: preferLoopbackOrigin(c.req.url),
    });
  });

  app.get("/api/admin/channels", (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    return c.json({
      ...channels.callbackInfo(c.req.url),
      wechat: channels.publicWechat(),
      wechatBot: channels.publicWechatBot(),
    });
  });

  app.get("/api/admin/channels/events", (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    const kind = c.req.query("kind") || "wechat_mp";
    return c.json({ events: channels.listEvents(kind) });
  });

  app.patch("/api/admin/channels", async (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    const body = (await readJsonCapped(c.req.raw, 8192)) as {
      kind?: string;
      label?: string;
      appId?: string;
      appSecret?: string;
      token?: string;
      aesKey?: string | null;
      enabled?: boolean;
    };
    if (body.kind && body.kind !== "wechat_mp") return c.json({ error: "unsupported channel" }, 400);
    let wechat;
    try {
      wechat = channels.upsertWechat({
        label: body.label,
        appId: body.appId,
        appSecret: body.appSecret,
        token: body.token,
        aesKey: body.aesKey,
        enabled: body.enabled,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "save failed" }, 400);
    }
    return c.json({
      ...channels.callbackInfo(c.req.url),
      wechat,
      wechatBot: channels.publicWechatBot(),
    });
  });

  app.post("/api/admin/channels/wechat-bot/qr", async (c) => {
    const user = superadmin(c);
    if (!user) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    try {
      return c.json(await channels.startBotQr(user.id));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "qr failed" }, 502);
    }
  });

  app.get("/api/admin/channels/wechat-bot/qr", async (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    const sessionKey = c.req.query("sessionKey") ?? "";
    const verifyCode = c.req.query("verifyCode") ?? undefined;
    if (!sessionKey) return c.json({ error: "sessionKey required" }, 400);
    return c.json(await channels.pollBotQr(sessionKey, verifyCode));
  });

  app.post("/api/admin/channels/wechat-bot/logout", (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    channels.logoutBot();
    return c.json({ wechatBot: channels.publicWechatBot() });
  });

  app.get("/api/admin/users", (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    return c.json({
      users: db.users.list().map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        canReply: u.can_reply === 1,
        disabled: u.disabled === 1,
        createdAt: u.created_at,
      })),
    });
  });

  app.patch("/api/admin/users/:id", async (c) => {
    if (!superadmin(c)) return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    const user = db.users.getById(id);
    if (!user) return c.json({ error: "not found" }, 404);
    if (user.role === "superadmin") return c.json({ error: "cannot edit superadmin" }, 409);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { canReply?: boolean; disabled?: boolean };
    db.users.updateFlags(id, { can_reply: body.canReply, disabled: body.disabled });
    if (body.disabled === true) db.sessions.deleteByUser(id);
    const next = db.users.getById(id)!;
    return c.json({
      id: next.id,
      username: next.username,
      role: next.role,
      canReply: next.can_reply === 1,
      disabled: next.disabled === 1,
    });
  });

  return app;
}
