import { Hono, type Context } from "hono";
import type { Config } from "@carbon-ai/config";
import { buildYouResponse, openaiError } from "@carbon-ai/protocol";
import type { CarbonDb } from "@carbon-ai/db";
import { presentedClientKey, verifyClientKey } from "../auth/client-keys.ts";
import { JobEngine } from "../job/engine.ts";
import { JobNotFoundError } from "../job/errors.ts";

export function openaiResponsesRoutes(cfg: Config, engine: JobEngine, db?: CarbonDb): Hono {
  const app = new Hono();

  const clientOr401 = (c: { req: { raw: Request } }) => {
    const id = verifyClientKey(cfg, presentedClientKey(c.req.raw.headers), db);
    if (!id) return undefined;
    return id;
  };

  const unauthorized = () =>
    openaiError("Invalid API key", { type: "invalid_request_error", code: "invalid_api_key" });

  const cancel = (c: Context) => {
    if (!clientOr401(c)) return c.json(unauthorized(), 401);
    const found = engine.lookupVendor(c.req.param("id"));
    if (!found || found.deleted || found.protocol !== "openai_responses") {
      return c.json(openaiError("response not found"), 404);
    }
    return c.json(openaiError("background responses not supported", { type: "invalid_request_error" }), 409);
  };

  const getOne = (c: Context) => {
    if (!clientOr401(c)) return c.json(unauthorized(), 401);
    const vendorId = c.req.param("id");
    const found = engine.lookupVendor(vendorId);
    if (!found || found.deleted || found.protocol !== "openai_responses") {
      return c.json(openaiError("response not found"), 404);
    }
    const live = found.status === "pending" || found.status === "claimed" || found.status === "streaming";
    if (live) {
      const req = engine.normalized(found.id);
      return c.json(
        buildYouResponse({
          id: vendorId,
          createdAtSec: Math.floor(found.createdAt / 1000),
          status: "in_progress",
          req,
          output: [],
          usage: null,
        }),
      );
    }
    try {
      return c.json(engine.json(found.id));
    } catch (err) {
      if (err instanceof JobNotFoundError) return c.json(openaiError("response not found"), 404);
      throw err;
    }
  };

  const remove = (c: Context) => {
    if (!clientOr401(c)) return c.json(unauthorized(), 401);
    const vendorId = c.req.param("id");
    const found = engine.lookupVendor(vendorId);
    if (!found || found.deleted || found.protocol !== "openai_responses") {
      return c.json(openaiError("response not found"), 404);
    }
    engine.softDelete(found.id);
    return c.json({ id: vendorId, object: "response", deleted: true });
  };

  app.post("/v1/responses/:id/cancel", cancel);
  app.post("/responses/:id/cancel", cancel);
  app.post("/v1/v1/responses/:id/cancel", cancel);
  app.get("/v1/responses/:id", getOne);
  app.get("/responses/:id", getOne);
  app.get("/v1/v1/responses/:id", getOne);
  app.delete("/v1/responses/:id", remove);
  app.delete("/responses/:id", remove);
  app.delete("/v1/v1/responses/:id", remove);

  return app;
}
