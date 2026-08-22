import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { CarbonDb } from "@carbon-ai/db";
import { USER_COOKIE, UserSessions } from "../auth/user-session.ts";
import { readJsonCapped } from "../http/read-json-capped.ts";

export function adminRoutes(db: CarbonDb, sessions: UserSessions): Hono {
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
