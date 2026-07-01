import { Hono } from "hono";
import type { Config } from "@carbon-ai/config";
import { emptyNormalizedRequest, type AssistantBlock, type Protocol } from "@carbon-ai/protocol";
import { openSse } from "../http/sse-pipe.ts";
import { readBytesCapped, readJsonCapped } from "../http/read-json-capped.ts";
import { JobEngine } from "../job/engine.ts";
import { BodyTooLargeError, JobConflictError, JobNotFoundError, JobQueueFullError } from "../job/errors.ts";

const PROTOCOLS: Protocol[] = ["anthropic_messages", "openai_chat", "openai_responses"];

function headersOf(c: { req: { raw: Request } }): Record<string, string> {
  const out: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function httpError(err: unknown): { status: number; body: unknown } {
  if (err instanceof JobQueueFullError) {
    return {
      status: 429,
      body: {
        type: "error",
        error: { type: "rate_limit_error", message: err.message },
      },
    };
  }
  if (err instanceof BodyTooLargeError) {
    return { status: 413, body: { type: "error", error: { type: "invalid_request_error", message: err.message } } };
  }
  if (err instanceof JobNotFoundError) return { status: 404, body: { error: err.message } };
  if (err instanceof JobConflictError) return { status: 409, body: { error: err.message } };
  throw err;
}

export function debugJobRoutes(cfg: Config, engine: JobEngine): Hono {
  const app = new Hono();

  app.post("/debug/jobs", async (c) => {
    try {
      const raw = await readBytesCapped(c.req.raw, cfg.server.maxBodyBytes);
      let parsed: Record<string, unknown> = {};
      if (raw.byteLength > 0) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
        } catch {
          return c.json({ error: "invalid json" }, 400);
        }
      }
      const protocol = PROTOCOLS.includes(parsed.protocol as Protocol)
        ? (parsed.protocol as Protocol)
        : "anthropic_messages";
      const stream = parsed.stream !== false;
      const text = typeof parsed.text === "string" ? parsed.text : "hi";
      const summary = await engine.create({
        protocol,
        stream,
        rawBody: raw,
        headers: headersOf(c),
        normalized: emptyNormalizedRequest({
          protocol,
          stream,
          model: typeof parsed.model === "string" ? parsed.model : cfg.models.defaultId,
          messages: [{ role: "user", parts: [{ type: "text", text }] }],
        }),
      });
      return c.json(summary, 201);
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
  });

  app.get("/debug/jobs", (c) => c.json({ jobs: engine.list() }));

  app.get("/debug/jobs/:id", (c) => {
    try {
      return c.json(engine.get(c.req.param("id")));
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
  });

  app.get("/debug/jobs/:id/stream", (c) => {
    const id = c.req.param("id");
    try {
      engine.get(id);
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
    return openSse(c, {
      onAbort: () => {
        void engine.cancel(id, "client_disconnect");
      },
      run: async (writer, ctl) => {
        await engine.attachSse(id, writer);
        await engine.waitUntilTerminal(id);
        void ctl;
      },
    });
  });

  app.get("/debug/jobs/:id/wait", async (c) => {
    const id = c.req.param("id");
    try {
      const terminal = await engine.waitUntilTerminal(id);
      if (terminal.status !== "completed") {
        return c.json({ status: terminal.status, error: terminal.error }, terminal.status === "failed" ? 500 : 409);
      }
      return c.json(engine.json(id));
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
  });

  app.post("/debug/jobs/:id/complete", async (c) => {
    const id = c.req.param("id");
    try {
      const body = (await readJsonCapped(c.req.raw, cfg.server.maxBodyBytes)) as {
        blocks?: AssistantBlock[];
        text?: string;
      };
      const blocks: AssistantBlock[] =
        body.blocks ?? [{ type: "text", text: typeof body.text === "string" ? body.text : "ok" }];
      const output = await engine.completeFromTest(id, blocks);
      return c.json(output);
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
  });

  app.post("/debug/jobs/:id/cancel", async (c) => {
    try {
      await engine.cancel(c.req.param("id"), "operator");
      return c.json({ ok: true });
    } catch (err) {
      const { status, body } = httpError(err);
      return c.json(body, status);
    }
  });

  return app;
}
