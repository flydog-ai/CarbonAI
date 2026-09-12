import { Hono, type Context } from "hono";
import type { Config } from "@carbon-ai/config";
import type { CarbonDb } from "@carbon-ai/db";
import { anthropicError, listModels, openaiError } from "@carbon-ai/protocol";
import { presentedClientKey, verifyClientKey } from "../auth/client-keys.ts";
import { requestSight } from "../auth/sight.ts";
import { rememberCaller } from "../auth/visitors.ts";

function isAnthropic(c: { req: { header: (n: string) => string | undefined } }): boolean {
  return Boolean(c.req.header("anthropic-version"));
}

export function modelsRoutes(cfg: Config, db?: CarbonDb): Hono {
  const app = new Hono();

  const catalog = (): ReturnType<typeof listModels> =>
    listModels({
      defaultId: cfg.models.defaultId,
      defaultDisplay: cfg.models.defaultDisplay,
      aliases: cfg.models.aliases,
    });

  const requireClient = (c: {
    req: { raw: Request; header: (n: string) => string | undefined };
  }) => {
    const id = verifyClientKey(cfg, presentedClientKey(c.req.raw.headers), db);
    if (!id) {
      return isAnthropic(c)
        ? anthropicError("authentication_error", "invalid x-api-key")
        : openaiError("Invalid API key", { type: "invalid_request_error", code: "invalid_api_key" });
    }
    return id;
  };

  const list = (c: Context) => {
    const client = requireClient(c);
    if ("error" in client) return c.json(client, 401);
    if (db) rememberCaller(db, client, requestSight(c, cfg));
    const models = catalog();
    if (isAnthropic(c)) {
      const data = models.map((m) => ({
        type: "model",
        id: m.id,
        display_name: m.displayName,
        created_at: "2026-01-01T00:00:00Z",
      }));
      return c.json({
        data,
        has_more: false,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
      });
    }
    return c.json({
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "carbon-ai",
      })),
    });
  };

  const one = (c: Context) => {
    const client = requireClient(c);
    if ("error" in client) return c.json(client, 401);
    if (db) rememberCaller(db, client, requestSight(c, cfg));
    const id = c.req.param("id");
    const found = catalog().find((m) => m.id === id);
    const display = found?.displayName ?? cfg.models.defaultDisplay;
    if (isAnthropic(c)) {
      return c.json({
        type: "model",
        id,
        display_name: display,
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    return c.json({ id, object: "model", created: 0, owned_by: "carbon-ai" });
  };

  app.get("/v1/models", list);
  app.get("/models", list);
  app.get("/v1/v1/models", list);
  app.get("/v1/models/:id", one);
  app.get("/models/:id", one);
  app.get("/v1/v1/models/:id", one);

  return app;
}
