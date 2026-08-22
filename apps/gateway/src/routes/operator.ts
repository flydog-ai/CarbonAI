import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "@carbon-ai/config";
import { OPERATOR_COOKIE, OperatorSessions } from "../auth/operator-session.ts";
import { USER_COOKIE, UserSessions } from "../auth/user-session.ts";
import type { CarbonDb } from "@carbon-ai/db";
import { readJsonCapped } from "../http/read-json-capped.ts";
import { JobEngine } from "../job/engine.ts";
import { JobConflictError, JobNotFoundError } from "../job/errors.ts";
import { pageContext } from "../operator/context.ts";

export function operatorRoutes(cfg: Config, engine: JobEngine, db: CarbonDb, userSessions: UserSessions): Hono {
  const app = new Hono();
  const sessions = new OperatorSessions(cfg.auth.operatorToken);

  const authed = (c: Context): { id: string } | "forbidden" | undefined => {
    const us = userSessions.get(getCookie(c, USER_COOKIE));
    if (!us) return undefined;
    const user = db.users.getById(us.userId);
    if (!user || user.disabled) return undefined;
    if (!user.can_reply) return "forbidden";
    return { id: user.id };
  };

  const requireReply = (c: Context) => {
    const a = authed(c);
    if (a === "forbidden") return "forbidden" as const;
    return a;
  };

  app.post("/api/operator/login", async (c) => {
    const body = (await readJsonCapped(c.req.raw, 4096)) as { token?: string };
    const session = sessions.login(typeof body.token === "string" ? body.token : "");
    if (!session) return c.json({ error: "invalid operator token" }, 401);
    setCookie(c, OPERATOR_COOKIE, session.id, {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      maxAge: 14 * 24 * 60 * 60,
    });
    return c.json({ ok: true });
  });

  app.post("/api/operator/logout", (c) => {
    sessions.logout(getCookie(c, OPERATOR_COOKIE));
    deleteCookie(c, OPERATOR_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/operator/session", (c) => {
    const s = requireReply(c);
    if (s === "forbidden") return c.json({ ok: false, error: "no reply permission" }, 403);
    if (!s) return c.json({ ok: false }, 401);
    return c.json({ ok: true });
  });

  app.get("/api/operator/jobs", (c) => {
    const s = requireReply(c);
    if (s === "forbidden") return c.json({ error: "no reply permission" }, 403);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    return c.json({ jobs: engine.list() });
  });

  app.get("/api/operator/jobs/:id", (c) => {
    const s = requireReply(c);
    if (s === "forbidden") return c.json({ error: "no reply permission" }, 403);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    try {
      return c.json(engine.get(c.req.param("id")));
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.get("/api/operator/jobs/:id/context", (c) => {
    const s = requireReply(c);
    if (s === "forbidden") return c.json({ error: "no reply permission" }, 403);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    try {
      const req = engine.normalized(id);
      const cursor = c.req.query("cursor") ?? "0";
      const limit = Number(c.req.query("limit") ?? "50");
      return c.json(pageContext(id, req, cursor, Number.isFinite(limit) ? limit : 50, engine.output(id)));
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.post("/api/operator/jobs/:id/complete", async (c) => {
    const session = requireReply(c);
    if (session === "forbidden") return c.json({ error: "no reply permission" }, 403);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    try {
      const body = (await readJsonCapped(c.req.raw, cfg.server.maxBodyBytes)) as { text?: string };
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) return c.json({ error: "text is required" }, 400);
      const output = await engine.completeFromTest(id, [{ type: "text", text }], { sessionId: session.id });
      return c.json(output);
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof JobConflictError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  app.post("/api/operator/jobs/:id/cancel", async (c) => {
    const s = requireReply(c);
    if (s === "forbidden") return c.json({ error: "no reply permission" }, 403);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    try {
      await engine.cancel(c.req.param("id"), "operator");
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  return app;
}
