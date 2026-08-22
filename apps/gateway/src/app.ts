import { Hono } from "hono";
import type { Config } from "@carbon-ai/config";
import { HangRegistry } from "./debug/hang-registry.ts";
import type { JobEngine } from "./job/engine.ts";
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
  app.route("/", modelsRoutes(cfg));
  app.route("/", debugRoutes(sessions));
  if (deps.engine) {
    app.route("/", operatorRoutes(cfg, deps.engine));
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
