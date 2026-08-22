import { Hono, type Context } from "hono";
import type { Config } from "@carbon-ai/config";
import {
  AnthropicAdapter,
  AnthropicRequestError,
  anthropicError,
  estimateRequestTokens,
  normalizeAnthropicRequest,
} from "@carbon-ai/protocol";
import type { CarbonDb } from "@carbon-ai/db";
import { presentedClientKey, verifyClientKey } from "../auth/client-keys.ts";
import { openSse } from "../http/sse-pipe.ts";
import { readBytesCapped } from "../http/read-json-capped.ts";
import { JobEngine } from "../job/engine.ts";
import { BodyTooLargeError, JobQueueFullError } from "../job/errors.ts";

function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function anthropicRoutes(cfg: Config, engine: JobEngine, db?: CarbonDb): Hono {
  const app = new Hono();

  const clientOr401 = (c: { req: { raw: Request } }) => {
    const id = verifyClientKey(cfg, presentedClientKey(c.req.raw.headers), db);
    if (!id) return undefined;
    return id;
  };

  app.post("/v1/messages/count_tokens", async (c) => {
    if (!clientOr401(c)) return c.json(anthropicError("authentication_error", "invalid x-api-key"), 401);
    try {
      const raw = await readBytesCapped(c.req.raw, cfg.server.maxBodyBytes);
      const body: unknown = JSON.parse(new TextDecoder().decode(raw));
      const normalized = normalizeAnthropicRequest(body, {
        defaultDisplay: cfg.models.defaultDisplay,
        aliases: cfg.models.aliases,
      });
      return c.json({ input_tokens: estimateRequestTokens(normalized) });
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.post("/v1/messages", async (c) => {
    const client = clientOr401(c);
    if (!client) return c.json(anthropicError("authentication_error", "invalid x-api-key"), 401);
    try {
      const raw = await readBytesCapped(c.req.raw, cfg.server.maxBodyBytes);
      let body: unknown;
      try {
        body = raw.byteLength === 0 ? {} : JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw new AnthropicRequestError("invalid json");
      }
      const normalized = normalizeAnthropicRequest(body, {
        defaultDisplay: cfg.models.defaultDisplay,
        aliases: cfg.models.aliases,
      });
      const summary = await engine.create({
        protocol: "anthropic_messages",
        model: normalized.model,
        stream: normalized.stream,
        rawBody: raw,
        headers: headersOf(c.req.raw),
        normalized,
        adapter: new AnthropicAdapter(),
        clientKeyId: client.keyId,
        clientLabel: client.label,
        userId: client.userId,
      });
      console.log(
        `job ${summary.id} ${normalized.stream ? "streaming" : "json"} model=${normalized.model} — complete: POST /debug/jobs/${summary.id}/complete`,
      );
      if (normalized.stream) {
        return openSse(c, {
          onAbort: () => {
            void engine.cancel(summary.id, "client_disconnect");
          },
          run: async (writer) => {
            await engine.attachSse(summary.id, writer);
            await engine.waitUntilTerminal(summary.id);
          },
        });
      }
      const terminal = await engine.waitUntilTerminal(summary.id);
      if (terminal.status !== "completed") {
        return c.json(
          anthropicError("overloaded_error", terminal.error ?? "Carbon AI operator wait ended"),
          terminal.status === "cancelled" ? 409 : 500,
        );
      }
      return c.json(engine.json(summary.id));
    } catch (err) {
      return mapError(c, err);
    }
  });

  return app;
}

function mapError(c: Context, err: unknown): Response {
  if (err instanceof AnthropicRequestError) return c.json(err.body(), 400);
  if (err instanceof BodyTooLargeError) {
    return c.json(anthropicError("invalid_request_error", "request too large"), 413);
  }
  if (err instanceof JobQueueFullError) {
    return c.json(anthropicError("rate_limit_error", err.message), 429);
  }
  if (err instanceof SyntaxError) return c.json(anthropicError("invalid_request_error", "invalid json"), 400);
  throw err;
}
