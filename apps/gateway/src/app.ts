import { Hono } from "hono";
import type { Config } from "@carbon-ai/config";
import { HangRegistry } from "./debug/hang-registry.ts";
import type { CarbonDb } from "@carbon-ai/db";
import type { JobEngine } from "./job/engine.ts";
import { UserSessions } from "./auth/user-session.ts";
import { authRoutes } from "./routes/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { anthropicError } from "@carbon-ai/protocol";
import { healthRoutes } from "./routes/health.ts";
import { helloRoutes } from "./routes/hello.ts";
import { homeRoutes } from "./routes/home.ts";
import { modelsRoutes } from "./routes/models.ts";
import { anthropicRoutes } from "./routes/anthropic.ts";
import { debugRoutes } from "./routes/debug.ts";
import { debugJobRoutes } from "./routes/debug-jobs.ts";
import { operatorRoutes } from "./routes/operator.ts";

export type AppDeps = {
  sessions?: HangRegistry;
  engine?: JobEngine;
  db?: CarbonDb;
};

/**
 * INVARIANT: do not mount hono/compress (or any gzip middleware) globally.
 * Compressed SSE buffers the entire hang until the callback returns.
 */
export function createApp(cfg: Config, deps: AppDeps = {}): Hono {
  const app = new Hono();
  const sessions = deps.sessions ?? new HangRegistry();

  app.route("/", homeRoutes(cfg));
  app.route("/", healthRoutes());
  app.route("/", helloRoutes());
  app.route("/", modelsRoutes(cfg, deps.db));
  app.route("/", debugRoutes(sessions));
  if (deps.engine && deps.db) {
    const userSessions = new UserSessions();
    app.route("/", authRoutes(deps.db, userSessions));
    app.route("/", adminRoutes(deps.db, userSessions));
    app.route("/", operatorRoutes(cfg, deps.engine, deps.db, userSessions));
    app.route("/", anthropicRoutes(cfg, deps.engine, deps.db));
    app.route("/", debugJobRoutes(cfg, deps.engine));
  } else if (deps.engine) {
    app.route("/", anthropicRoutes(cfg, deps.engine));
    app.route("/", debugJobRoutes(cfg, deps.engine));
  }

  app.notFound((c) => {
    if (c.req.header("anthropic-version")) {
      return c.json(anthropicError("not_found_error", `Not Found: ${c.req.path}`), 404);
    }
    return c.json({ error: "not found" }, 404);
  });

  return app;
}
