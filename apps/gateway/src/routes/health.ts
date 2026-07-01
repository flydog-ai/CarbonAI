import { Hono } from "hono";

export function healthRoutes(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, name: "carbon-ai" }));
  app.get("/ready", (c) => c.json({ ok: true }));
  return app;
}
