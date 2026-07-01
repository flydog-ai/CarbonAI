import { Hono } from "hono";

/** Claude Code warmup. 200 empty body. */
export function helloRoutes(): Hono {
  const app = new Hono();
  app.on(["GET", "HEAD"], "/api/hello", (c) => {
    c.status(200);
    return c.body(null);
  });
  return app;
}
