import { Hono, type Context } from "hono";
import type { Config } from "@carbon-ai/config";
import {
  AnthropicAdapter,
  AnthropicRequestError,
  anthropicError,
  detectProtocol,
  estimateRequestTokens,
  normalizeAnthropicRequest,
  normalizeOpenAIChatRequest,
  normalizeOpenAIResponsesRequest,
  OpenAIChatAdapter,
  OpenAIRequestError,
  OpenAIResponsesAdapter,
  openaiError,
  type ContentPart,
  type NormalizedRequest,
  type Protocol,
  type ProtocolAdapter,
} from "@carbon-ai/protocol";
import type { CarbonDb } from "@carbon-ai/db";
import { presentedClientKey, verifyClientKey } from "../auth/client-keys.ts";
import { requestSight } from "../auth/sight.ts";
import { rememberCaller } from "../auth/visitors.ts";
import { openSse } from "../http/sse-pipe.ts";
import { readBytesCapped } from "../http/read-json-capped.ts";
import { JobEngine } from "../job/engine.ts";
import { BodyTooLargeError, JobQueueFullError } from "../job/errors.ts";

function stitchPrevious(engine: JobEngine, next: NormalizedRequest, priorJobId: string): void {
  const prev = engine.normalized(priorJobId);
  const out = engine.output(priorJobId);
  const assistantParts: ContentPart[] = out.blocks.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        kind: block.kind,
        id: block.id,
        callId: block.callId,
        name: block.name,
        payload: block.payload,
      };
    }
    if (block.type === "reasoning") {
      return {
        type: "reasoning",
        id: block.id,
        summary: block.summary,
        encryptedContent: block.encryptedContent,
      };
    }
    if (block.type === "thinking") {
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    }
    return { type: "unknown", vendorType: "block", raw: block };
  });
  next.system = [...prev.system, ...next.system];
  next.messages = [
    ...prev.messages,
    ...(assistantParts.length ? [{ role: "assistant" as const, parts: assistantParts }] : []),
    ...next.messages,
  ];
}

function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function preferAnthropicEnvelope(c: Context, protocol?: Protocol): boolean {
  if (protocol === "anthropic_messages") return true;
  if (protocol === "openai_chat" || protocol === "openai_responses") return false;
  return Boolean(c.req.header("anthropic-version")) || c.req.path.includes("/messages");
}

export function vendorRoutes(cfg: Config, engine: JobEngine, db?: CarbonDb): Hono {
  const app = new Hono();
  const modelOpts = { defaultDisplay: cfg.models.defaultDisplay, aliases: cfg.models.aliases };

  const clientOf = (c: Context) => verifyClientKey(cfg, presentedClientKey(c.req.raw.headers), db);

  const unauth = (c: Context, protocol?: Protocol) => {
    if (preferAnthropicEnvelope(c, protocol)) {
      return c.json(anthropicError("authentication_error", "invalid x-api-key"), 401);
    }
    return c.json(openaiError("Invalid API key", { type: "invalid_request_error", code: "invalid_api_key" }), 401);
  };

  const adapterFor = (protocol: Protocol): ProtocolAdapter => {
    if (protocol === "openai_chat") {
      return new OpenAIChatAdapter({
        heartbeat: cfg.openaiChat.heartbeat,
        midstreamError: cfg.openaiChat.midstreamError,
      });
    }
    if (protocol === "openai_responses") {
      return new OpenAIResponsesAdapter({ heartbeat: cfg.openaiResponses.heartbeat });
    }
    return new AnthropicAdapter();
  };

  const countTokens = async (c: Context) => {
    if (!clientOf(c)) return unauth(c);
    try {
      const raw = await readBytesCapped(c.req.raw, cfg.server.maxBodyBytes);
      const body: unknown = JSON.parse(new TextDecoder().decode(raw));
      const protocol = detectProtocol(body, c.req.raw.headers, c.req.path) ?? "anthropic_messages";
      const normalized =
        protocol === "openai_chat"
          ? normalizeOpenAIChatRequest(body, modelOpts)
          : protocol === "openai_responses"
            ? normalizeOpenAIResponsesRequest(body, modelOpts)
            : normalizeAnthropicRequest(body, modelOpts);
      return c.json({ input_tokens: estimateRequestTokens(normalized) });
    } catch (err) {
      return mapError(c, err);
    }
  };

  const create = async (c: Context) => {
    const client = clientOf(c);
    if (!client) return unauth(c);
    try {
      const raw = await readBytesCapped(c.req.raw, cfg.server.maxBodyBytes);
      let body: unknown;
      try {
        body = raw.byteLength === 0 ? {} : JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw preferAnthropicEnvelope(c)
          ? new AnthropicRequestError("invalid json")
          : new OpenAIRequestError("invalid json");
      }
      const protocol = detectProtocol(body, c.req.raw.headers, c.req.path);
      if (!protocol) {
        throw preferAnthropicEnvelope(c)
          ? new AnthropicRequestError("model: Field required")
          : new OpenAIRequestError("could not detect request shape", { param: "model" });
      }
      const normalized =
        protocol === "openai_chat"
          ? normalizeOpenAIChatRequest(body, modelOpts)
          : protocol === "openai_responses"
            ? normalizeOpenAIResponsesRequest(body, modelOpts)
            : normalizeAnthropicRequest(body, modelOpts);
      if (protocol === "openai_responses" && normalized.previousResponseId) {
        const prior = engine.lookupVendor(normalized.previousResponseId);
        if (!prior || prior.deleted || prior.protocol !== "openai_responses") {
          throw new OpenAIRequestError("No response found with the given previous_response_id.", {
            param: "previous_response_id",
          });
        }
        stitchPrevious(engine, normalized, prior.id);
      }
      const sight = requestSight(c, cfg, { protocol });
      const caller = db ? rememberCaller(db, client, sight, { protocol }) : undefined;
      const summary = await engine.create({
        protocol,
        model: normalized.model,
        stream: normalized.stream,
        rawBody: raw,
        headers: headersOf(c.req.raw),
        normalized,
        adapter: adapterFor(protocol),
        clientKeyId: caller?.clientKeyId ?? client.keyId,
        clientLabel: caller?.clientLabel ?? client.label,
        userId: client.userId,
        visitorId: caller?.visitorId,
        callerLabel: caller?.callerLabel,
        clientKind: sight.clientKind,
        clientIp: sight.ip,
        keyPrefix: caller?.keyPrefix ?? client.keyPrefix,
      });
      console.log(
        `job ${summary.id} ${normalized.stream ? "streaming" : "json"} ${protocol} model=${normalized.model} — complete: POST /debug/jobs/${summary.id}/complete`,
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
        const timeout = terminal.code === "timeout" || terminal.error === "Carbon AI operator wait timeout";
        if (protocol === "anthropic_messages") {
          return c.json(
            anthropicError("overloaded_error", terminal.error ?? "Carbon AI operator wait ended"),
            terminal.status === "cancelled" ? 409 : 500,
          );
        }
        return c.json(
          openaiError(terminal.error ?? "Carbon AI operator wait ended", {
            type: "server_error",
            code: timeout ? "timeout" : terminal.code ?? "server_error",
          }),
          timeout ? 504 : terminal.status === "cancelled" ? 409 : 500,
        );
      }
      return c.json(engine.json(summary.id));
    } catch (err) {
      return mapError(c, err);
    }
  };

  const createPaths = [
    "/v1/messages",
    "/messages",
    "/v1/v1/messages",
    "/v1/chat/completions",
    "/chat/completions",
    "/v1/v1/chat/completions",
    "/v1/responses",
    "/responses",
    "/v1/v1/responses",
    "/v1",
  ];
  for (const p of createPaths) app.post(p, create);

  app.post("/v1/messages/count_tokens", countTokens);
  app.post("/messages/count_tokens", countTokens);

  return app;
}

function mapError(c: Context, err: unknown): Response {
  if (err instanceof AnthropicRequestError) return c.json(err.body(), 400);
  if (err instanceof OpenAIRequestError) return c.json(err.body(), err.httpStatus);
  if (err instanceof BodyTooLargeError) {
    if (preferAnthropicEnvelope(c)) return c.json(anthropicError("invalid_request_error", "request too large"), 413);
    return c.json(openaiError("request too large"), 413);
  }
  if (err instanceof JobQueueFullError) {
    if (preferAnthropicEnvelope(c)) return c.json(anthropicError("rate_limit_error", err.message), 429);
    return c.json(
      openaiError("Too many concurrent Carbon AI jobs", { type: "requests", code: "rate_limit_exceeded" }),
      429,
    );
  }
  if (err instanceof SyntaxError) {
    if (preferAnthropicEnvelope(c)) return c.json(anthropicError("invalid_request_error", "invalid json"), 400);
    return c.json(openaiError("invalid json"), 400);
  }
  throw err;
}
