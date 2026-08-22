import { Hono } from "hono";
import { serveConsole } from "../operator/static.ts";

export function consoleRoutes(): Hono {
  const app = new Hono();
  app.get("/console", (c) => serveConsole(c));
  app.get("/console/", (c) => serveConsole(c));
  app.get("/console/*", (c) => serveConsole(c));
  app.get("/ui", (c) => c.redirect("/console"));
  app.get("/ui/", (c) => c.redirect("/console"));
  return app;
}
