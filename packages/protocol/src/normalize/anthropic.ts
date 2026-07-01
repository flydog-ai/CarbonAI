import type { ContentPart, NormalizedMessage, NormalizedRequest, NormalizedTool } from "../events.ts";
import { AnthropicRequestError } from "../errors/anthropic.ts";
import { displayNameFor, stripContextSuffix } from "../models.ts";

type Block = Record<string, unknown>;

function asRecord(value: unknown): Block | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Block) : undefined;
}

function parsePart(block: unknown): ContentPart {
  if (typeof block === "string") return { type: "text", text: block };
  const b = asRecord(block);
  if (!b || typeof b.type !== "string") {
    return { type: "unknown", vendorType: "unknown", raw: block };
  }
  switch (b.type) {
    case "text":
      return { type: "text", text: typeof b.text === "string" ? b.text : "" };
    case "image": {
      const source = asRecord(b.source);
      const mediaType =
        (typeof source?.media_type === "string" && source.media_type) ||
        (typeof b.media_type === "string" && b.media_type) ||
        "image/png";
      const url = typeof source?.url === "string" ? source.url : undefined;
      const data = typeof source?.data === "string" ? source.data : undefined;
      return {
        type: "image",
        mediaType,
        source: url ? "url" : "base64",
        byteLength: data ? Math.ceil((data.length * 3) / 4) : 0,
        url,
      };
    }
    case "tool_use":
      return {
        type: "tool_use",
        kind: "anthropic_tool_use",
        id: typeof b.id === "string" ? b.id : "",
        callId: typeof b.id === "string" ? b.id : "",
        name: typeof b.name === "string" ? b.name : undefined,
        payload: { form: "json", value: b.input ?? {} },
      };
    case "tool_result": {
      const raw = b.content;
      const content: ContentPart[] = Array.isArray(raw)
        ? raw.map(parsePart)
        : typeof raw === "string"
          ? [{ type: "text", text: raw }]
          : [];
      return {
        type: "tool_result",
        kind: "anthropic_tool_use",
        toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
        isError: b.is_error === true,
        content,
        vendorRaw: block,
      };
    }
    case "document":
      return {
        type: "document",
        title: typeof b.title === "string" ? b.title : undefined,
        mediaType: typeof b.media_type === "string" ? b.media_type : "application/pdf",
        byteLength: 0,
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: typeof b.thinking === "string" ? b.thinking : "",
        signature: typeof b.signature === "string" ? b.signature : undefined,
      };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: typeof b.data === "string" ? b.data : "" };
    default:
      return { type: "unknown", vendorType: b.type, raw: block };
  }
}

function parseSystem(system: unknown): ContentPart[] {
  if (typeof system === "string") return system ? [{ type: "text", text: system }] : [];
  if (Array.isArray(system)) return system.map(parsePart);
  return [];
}

function parseMessage(raw: unknown, index: number): NormalizedMessage {
  const m = asRecord(raw);
  if (!m || typeof m.role !== "string") {
    throw new AnthropicRequestError(`messages.${index}.role: Field required`);
  }
  const role = m.role as NormalizedMessage["role"];
  const content = m.content;
  const parts: ContentPart[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content.map(parsePart)
        : [];
  return { role, parts };
}

function parseTools(raw: unknown): NormalizedTool[] {
  if (!Array.isArray(raw)) return [];
  const tools: NormalizedTool[] = [];
  for (const item of raw) {
    const t = asRecord(item);
    if (!t || typeof t.name !== "string") continue;
    tools.push({
      kind: "anthropic_tool_use",
      name: t.name,
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema: t.input_schema,
      vendorRaw: item,
    });
  }
  return tools;
}

export function normalizeAnthropicRequest(
  body: unknown,
  opts: { defaultDisplay: string; aliases: Record<string, string> },
): NormalizedRequest {
  const rec = asRecord(body);
  if (!rec) throw new AnthropicRequestError("model: Field required");
  if (typeof rec.model !== "string" || rec.model.length === 0) {
    throw new AnthropicRequestError("model: Field required");
  }
  if (!Array.isArray(rec.messages) || rec.messages.length < 1) {
    throw new AnthropicRequestError("messages: Field required");
  }
  if (typeof rec.max_tokens !== "number" || !Number.isFinite(rec.max_tokens)) {
    throw new AnthropicRequestError("max_tokens: Field required");
  }

  const model = rec.model;
  return {
    protocol: "anthropic_messages",
    model,
    displayModel: displayNameFor(model, opts.aliases, opts.defaultDisplay),
    system: parseSystem(rec.system),
    messages: rec.messages.map(parseMessage),
    tools: parseTools(rec.tools),
    toolChoice: rec.tool_choice ?? null,
    maxTokens: rec.max_tokens,
    stream: rec.stream === true,
    stopSequences: Array.isArray(rec.stop_sequences)
      ? rec.stop_sequences.filter((s): s is string => typeof s === "string")
      : [],
    metadata: asRecord(rec.metadata) ?? {},
    extras: { canonicalModel: stripContextSuffix(model) },
    thinking: rec.thinking,
  };
}
