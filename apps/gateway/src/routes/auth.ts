import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "@carbon-ai/config";
import { newApiKeyId, newUser, type CarbonDb } from "@carbon-ai/db";
import { claudeModelSlots } from "@carbon-ai/protocol";
import { resetBootstrapIfRequested } from "../auth/bootstrap.ts";
import { apiKeyPrefix, hashApiKey, mintApiKeyPlaintext, verifyClientKey } from "../auth/client-keys.ts";
import { USER_COOKIE, USER_SESSION_TTL_SEC, UserSessions } from "../auth/user-session.ts";
import type { ChannelHub } from "../channels/hub.ts";
import { buildCcSwitchClaudeImportHref, siteOrigin } from "../home/cc-switch.ts";
import { readJsonCapped } from "../http/read-json-capped.ts";

const USER_RE = /^[a-zA-Z0-9_-]{3,32}$/;

function publicUser(row: { id: string; username: string; role: string; can_reply: number; disabled: number }) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    canReply: row.can_reply === 1,
    disabled: row.disabled === 1,
  };
}

function setUserCookie(c: Context, sessionId: string): void {
  setCookie(c, USER_COOKIE, sessionId, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: USER_SESSION_TTL_SEC,
  });
}

export function authRoutes(cfg: Config, db: CarbonDb, sessions: UserSessions, channels?: ChannelHub): Hono {
  const app = new Hono();
  const authedUser = (c: Context) => {
    const s = sessions.get(getCookie(c, USER_COOKIE));
    if (!s) return undefined;
    const user = db.users.getById(s.userId);
    if (!user || user.disabled) return undefined;
    return user;
  };

  app.get("/account", (c) => c.redirect("/console?view=keys"));
  app.get("/account/", (c) => c.redirect("/console?view=keys"));

  app.get("/api/setup/status", async (c) => {
    await resetBootstrapIfRequested(cfg, db);
    return c.json({ needsSetup: db.users.count() === 0 });
  });

  app.post("/api/setup", async (c) => {
    if (db.users.count() > 0) return c.json({ error: "already set up" }, 409);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { username?: string; password?: string };
    const username = (body.username ?? "").trim() || cfg.auth.bootstrapUsername || "admin";
    const password = body.password ?? "";
    if (!USER_RE.test(username)) return c.json({ error: "username must be 3-32 letters, digits, _ or -" }, 400);
    if (password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
    const user = await newUser({ username, password, role: "superadmin", canReply: true });
    db.users.insert(user);
    const plaintext = mintApiKeyPlaintext();
    db.users.insertKey({
      id: newApiKeyId(),
      user_id: user.id,
      label: "default",
      key_hash: hashApiKey(plaintext),
      key_prefix: apiKeyPrefix(plaintext),
      key_plain: plaintext,
      created_at: Date.now(),
      revoked_at: null,
    });
    const session = sessions.login(user.id);
    setUserCookie(c, session.id);
    return c.json({ user: publicUser(user), apiKey: plaintext }, 201);
  });

  app.post("/api/auth/register", async (c) => {
    if (db.users.count() === 0) return c.json({ error: "setup required" }, 403);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { username?: string; password?: string };
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!USER_RE.test(username)) return c.json({ error: "username must be 3-32 letters, digits, _ or -" }, 400);
    if (password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
    if (db.users.getByUsername(username)) return c.json({ error: "username taken" }, 409);
    const user = await newUser({ username, password });
    db.users.insert(user);
    const plaintext = mintApiKeyPlaintext();
    db.users.insertKey({
      id: newApiKeyId(),
      user_id: user.id,
      label: "default",
      key_hash: hashApiKey(plaintext),
      key_prefix: apiKeyPrefix(plaintext),
      key_plain: plaintext,
      created_at: Date.now(),
      revoked_at: null,
    });
    const session = sessions.login(user.id);
    setUserCookie(c, session.id);
    return c.json({ user: publicUser(user), apiKey: plaintext }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    await resetBootstrapIfRequested(cfg, db);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { username?: string; password?: string };
    const user = db.users.getByUsername((body.username ?? "").trim());
    if (!user || user.disabled) return c.json({ error: "invalid credentials" }, 401);
    const ok = await Bun.password.verify(body.password ?? "", user.password_hash);
    if (!ok) return c.json({ error: "invalid credentials" }, 401);
    const session = sessions.login(user.id);
    setUserCookie(c, session.id);
    return c.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", (c) => {
    sessions.logout(getCookie(c, USER_COOKIE));
    deleteCookie(c, USER_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user: publicUser(user) });
  });

  app.get("/api/me/channels", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    return c.json({ wechat: channels.bindingFor(user.id), enabled: Boolean(channels.publicWechat()?.enabled) });
  });

  app.post("/api/me/channels/bind-code", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!user.can_reply) return c.json({ error: "no reply permission" }, 403);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    try {
      return c.json(channels.mintBindCode(user.id));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "bind failed" }, 400);
    }
  });

  app.post("/api/me/channels/unbind", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!channels) return c.json({ error: "unavailable" }, 503);
    channels.unbind(user.id);
    return c.json({ ok: true });
  });

  app.get("/api/me/guest-key", (c) => {
    const user = authedUser(c);
    if (!user || user.role !== "superadmin") return c.json({ error: "forbidden" }, 403);
    const keys = cfg.auth.apiKeys
      .filter((k) => k.key.trim())
      .map((k) => ({ label: k.label, prefix: apiKeyPrefix(k.key) }));
    return c.json({ keys });
  });

  app.get("/api/me/connect", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const endpoint = siteOrigin(cfg, c.req.url);
    const slots = claudeModelSlots({
      defaultId: cfg.models.defaultId,
      aliases: cfg.models.aliases,
    });
    return c.json({
      endpoint,
      openaiEndpoint: `${endpoint}/v1`,
      displayName: cfg.models.defaultDisplay || cfg.site.name || "Carbon AI",
      siteName: cfg.site.name,
      siteNameZh: cfg.site.nameZh,
      publicOrigin: cfg.site.publicOrigin,
      ...slots,
      notes: "One base URL and one key for every client. Path /v1 is optional. Bearer and x-api-key are the same secret.",
    });
  });

  app.post("/api/me/cc-switch", async (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { apiKey?: string };
    const apiKey = (body.apiKey ?? "").trim();
    const id = verifyClientKey(cfg, apiKey, db);
    if (!id || id.userId !== user.id) return c.json({ error: "key does not belong to this account" }, 403);
    const endpoint = siteOrigin(cfg, c.req.url);
    const displayName = cfg.models.defaultDisplay || cfg.site.name || "Carbon AI";
    const slots = claudeModelSlots({
      defaultId: cfg.models.defaultId,
      aliases: cfg.models.aliases,
    });
    const href = buildCcSwitchClaudeImportHref({
      name: displayName,
      endpoint,
      apiKey,
      homepage: endpoint,
      ...slots,
      notes: "Carbon AI operator gateway. ANTHROPIC_BASE_URL has no /v1. Use a claude-* model id.",
    });
    return c.json({ href, endpoint, ...slots });
  });

  app.get("/api/me/keys", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const keys = db.users.listKeys(user.id).map((k) => ({
      id: k.id,
      label: k.label,
      prefix: (k.key_plain ? apiKeyPrefix(k.key_plain) : k.key_prefix).replaceAll("\u2026", "..."),
      apiKey: k.key_plain ?? undefined,
      createdAt: k.created_at,
    }));
    return c.json({ keys });
  });

  app.post("/api/me/keys", async (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { label?: string };
    const label = (body.label ?? "key").trim() || "key";
    const plaintext = mintApiKeyPlaintext();
    const id = newApiKeyId();
    db.users.insertKey({
      id,
      user_id: user.id,
      label,
      key_hash: hashApiKey(plaintext),
      key_prefix: apiKeyPrefix(plaintext),
      key_plain: plaintext,
      created_at: Date.now(),
      revoked_at: null,
    });
    return c.json({ id, apiKey: plaintext, prefix: apiKeyPrefix(plaintext) }, 201);
  });

  const removeKey = (c: Context) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const key = db.users.getKey(c.req.param("id"));
    if (!key || key.user_id !== user.id) return c.json({ error: "not found" }, 404);
    db.users.deleteKey(key.id);
    return c.json({ ok: true });
  };
  app.delete("/api/me/keys/:id", removeKey);

  return app;
}
