import type { ContentPart, NormalizedMessage, NormalizedRequest, NormalizedTool, ToolPayload } from "../events.ts";
import { OpenAIRequestError } from "../errors/openai.ts";
import { displayNameFor, stripContextSuffix } from "../models.ts";
import { asRecord } from "../record.ts";

function parsePart(block: unknown): ContentPart {
  if (typeof block === "string") return { type: "text", text: block };
  const b = asRecord(block);
  if (!b || typeof b.type !== "string") {
    return { type: "unknown", vendorType: "unknown", raw: block };
  }
  switch (b.type) {
    case "text":
    case "input_text":
    case "output_text":
      return { type: "text", text: typeof b.text === "string" ? b.text : "" };
    case "image_url":
    case "image":
    case "input_image": {
      const imageUrl = b.image_url;
      const urlObj = asRecord(imageUrl);
      const url =
        (typeof imageUrl === "string" && imageUrl) ||
        (typeof urlObj?.url === "string" && urlObj.url) ||
        (typeof b.url === "string" && b.url) ||
        undefined;
      const dataUrl = url?.startsWith("data:") ? url : undefined;
      const comma = dataUrl?.indexOf(",") ?? -1;
      const data = comma >= 0 ? dataUrl!.slice(comma + 1) : undefined;
      let mediaType = "image/png";
      if (dataUrl) {
        const match = /^data:([^;]+)/.exec(dataUrl);
        if (match?.[1]) mediaType = match[1];
      }
      return {
        type: "image",
        mediaType,
        source: url && !dataUrl ? "url" : "base64",
        byteLength: data ? Math.ceil((data.length * 3) / 4) : 0,
        url: dataUrl ? undefined : url,
      };
    }
    default:
      return { type: "unknown", vendorType: b.type, raw: block };
  }
}

function parseToolCalls(raw: unknown): ContentPart[] {
  if (!Array.isArray(raw)) return [];
  const parts: ContentPart[] = [];
  for (const item of raw) {
    const t = asRecord(item);
    if (!t) continue;
    const fn = asRecord(t.function) ?? {};
    const name = typeof fn.name === "string" ? fn.name : undefined;
    const argsRaw = fn.arguments;
    const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
    let payload: ToolPayload = { form: "freeform", value: args };
    try {
      payload = { form: "json", value: JSON.parse(args) };
    } catch {
      payload = { form: "freeform", value: args };
    }
    if (name === "apply_patch") {
      const rec = payload.form === "json" ? asRecord(payload.value) : undefined;
      if (rec && typeof rec.input === "string") payload = { form: "freeform", value: rec.input };
      else if (args.startsWith("***")) payload = { form: "freeform", value: args };
    }
    const id = typeof t.id === "string" ? t.id : "";
    parts.push({
      type: "tool_use",
      kind: "openai_function",
      id,
      callId: id,
      name,
      payload,
    });
  }
  return parts;
}

function parseMessage(raw: unknown, index: number): NormalizedMessage {
  const m = asRecord(raw);
  if (!m || typeof m.role !== "string") {
    throw new OpenAIRequestError(`messages.${index}.role: Field required`, { param: `messages.${index}.role` });
  }
  const roleRaw = m.role === "function" ? "tool" : m.role;
  const role = roleRaw as NormalizedMessage["role"];
  const content = m.content;
  const parts: ContentPart[] = [];
  if (typeof content === "string") {
    if (content.length > 0) parts.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    for (const p of content) parts.push(parsePart(p));
  }
  parts.push(...parseToolCalls(m.tool_calls));
  if (role === "tool") {
    const callId = typeof m.tool_call_id === "string" ? m.tool_call_id : typeof m.name === "string" ? m.name : "";
    const contentParts =
      parts.length > 0
        ? parts.filter((p) => p.type !== "tool_use")
        : [{ type: "text" as const, text: typeof content === "string" ? content : "" }];
    return {
      role: "tool",
      parts: [
        {
          type: "tool_result",
          kind: "openai_function",
          toolUseId: callId,
          callId,
          content: contentParts,
          vendorRaw: raw,
        },
      ],
    };
  }
  return { role, parts };
}

function parseTools(rec: Record<string, unknown>): NormalizedTool[] {
  const tools: NormalizedTool[] = [];
  const unknown: string[] = [];
  if (Array.isArray(rec.tools)) {
    for (const item of rec.tools) {
      const t = asRecord(item);
      if (!t) continue;
      const type = typeof t.type === "string" ? t.type : "function";
      if (type !== "function") {
        unknown.push(type);
        continue;
      }
      const fn = asRecord(t.function) ?? t;
      const name = typeof fn.name === "string" ? fn.name : "";
      if (!name) continue;
      tools.push({
        kind: "openai_function",
        name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        inputSchema: fn.parameters ?? t.parameters,
        vendorRaw: item,
      });
    }
  }
  if (Array.isArray(rec.functions)) {
    for (const item of rec.functions) {
      const t = asRecord(item);
      if (!t || typeof t.name !== "string") continue;
      tools.push({
        kind: "openai_function",
        name: t.name,
        description: typeof t.description === "string" ? t.description : undefined,
        inputSchema: t.parameters,
        vendorRaw: item,
      });
    }
  }
  if (tools.length === 0 && unknown.length > 0) {
    throw new OpenAIRequestError(`unsupported tool type(s): ${[...new Set(unknown)].join(", ")}`, {
      param: "tools",
    });
  }
  return tools;
}

export function normalizeOpenAIChatRequest(
  body: unknown,
  opts: { defaultDisplay: string; aliases: Record<string, string> },
): NormalizedRequest {
  const rec = asRecord(body);
  if (!rec) throw new OpenAIRequestError("model: Field required", { param: "model" });
  if (typeof rec.model !== "string" || rec.model.length === 0) {
    throw new OpenAIRequestError("model: Field required", { param: "model" });
  }
  if (!Array.isArray(rec.messages) || rec.messages.length < 1) {
    throw new OpenAIRequestError("messages: Field required", { param: "messages" });
  }

  const streamOptions = asRecord(rec.stream_options);
  const maxTokens =
    typeof rec.max_completion_tokens === "number" && Number.isFinite(rec.max_completion_tokens)
      ? rec.max_completion_tokens
      : typeof rec.max_tokens === "number" && Number.isFinite(rec.max_tokens)
        ? rec.max_tokens
        : undefined;

  const stopSequences = Array.isArray(rec.stop)
    ? rec.stop.filter((s): s is string => typeof s === "string")
    : typeof rec.stop === "string"
      ? [rec.stop]
      : [];

  const model = rec.model;
  const metadata = asRecord(rec.metadata) ?? {};
  if (typeof rec.user === "string") metadata.user = rec.user;

  return {
    protocol: "openai_chat",
    model,
    displayModel: displayNameFor(model, opts.aliases, opts.defaultDisplay),
    system: [],
    messages: rec.messages.map(parseMessage),
    tools: parseTools(rec),
    toolChoice: rec.tool_choice ?? rec.function_call ?? null,
    maxTokens,
    stream: rec.stream === true,
    stopSequences,
    metadata,
    extras: {
      canonicalModel: stripContextSuffix(model),
      includeUsage: streamOptions?.include_usage === true,
      toolsRaw: rec.tools ?? rec.functions ?? [],
      user: typeof rec.user === "string" ? rec.user : null,
    },
  };
}
