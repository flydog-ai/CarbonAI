import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { newApiKeyId, newUser, type CarbonDb } from "@carbon-ai/db";
import { apiKeyPrefix, hashApiKey, mintApiKeyPlaintext } from "../auth/client-keys.ts";
import { USER_COOKIE, UserSessions } from "../auth/user-session.ts";
import { readJsonCapped } from "../http/read-json-capped.ts";
import { renderAccountPage } from "../operator/account-page.ts";

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

export function authRoutes(db: CarbonDb, sessions: UserSessions): Hono {
  const app = new Hono();
  const authedUser = (c: Context) => {
    const s = sessions.get(getCookie(c, USER_COOKIE));
    if (!s) return undefined;
    const user = db.users.getById(s.userId);
    if (!user || user.disabled) return undefined;
    return user;
  };

  app.get("/account", (c) => c.html(renderAccountPage()));
  app.get("/account/", (c) => c.html(renderAccountPage()));

  app.post("/api/auth/register", async (c) => {
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
      created_at: Date.now(),
      revoked_at: null,
    });
    const session = sessions.login(user.id);
    setCookie(c, USER_COOKIE, session.id, {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      maxAge: 14 * 24 * 60 * 60,
    });
    return c.json({ user: publicUser(user), apiKey: plaintext }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = (await readJsonCapped(c.req.raw, 4096)) as { username?: string; password?: string };
    const user = db.users.getByUsername((body.username ?? "").trim());
    if (!user || user.disabled) return c.json({ error: "invalid credentials" }, 401);
    const ok = await Bun.password.verify(body.password ?? "", user.password_hash);
    if (!ok) return c.json({ error: "invalid credentials" }, 401);
    const session = sessions.login(user.id);
    setCookie(c, USER_COOKIE, session.id, {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      maxAge: 14 * 24 * 60 * 60,
    });
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

  app.get("/api/me/keys", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const keys = db.users.listKeys(user.id).map((k) => ({
      id: k.id,
      label: k.label,
      prefix: k.key_prefix,
      createdAt: k.created_at,
      revoked: k.revoked_at != null,
    }));
    return c.json({ keys });
  });

  app.post("/api/me/keys", async (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = (await readJsonCapped(c.req.raw, 4096)) as { label?: string };
    const label = (body.label ?? "key").trim() || "key";
    const plaintext = mintApiKeyPlaintext();
    db.users.insertKey({
      id: newApiKeyId(),
      user_id: user.id,
      label,
      key_hash: hashApiKey(plaintext),
      key_prefix: apiKeyPrefix(plaintext),
      created_at: Date.now(),
      revoked_at: null,
    });
    return c.json({ apiKey: plaintext, prefix: apiKeyPrefix(plaintext) }, 201);
  });

  app.post("/api/me/keys/:id/revoke", (c) => {
    const user = authedUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const key = db.users.getKey(c.req.param("id"));
    if (!key || key.user_id !== user.id) return c.json({ error: "not found" }, 404);
    db.users.revokeKey(key.id, Date.now());
    return c.json({ ok: true });
  });

  return app;
}
