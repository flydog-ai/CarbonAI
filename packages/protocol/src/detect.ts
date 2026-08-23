import type { Protocol } from "./events.ts";
import { asRecord } from "./record.ts";

function header(headers: Headers | Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function toolType(item: unknown): string | undefined {
  const t = asRecord(item);
  return typeof t?.type === "string" ? t.type : undefined;
}

function pathHint(path: string | undefined): Protocol | undefined {
  if (!path) return undefined;
  if (path.includes("/responses")) return "openai_responses";
  if (path.includes("chat/completions") || path.includes("/completions")) return "openai_chat";
  if (path.includes("/messages")) return "anthropic_messages";
  return undefined;
}

/**
 * Infer the vendor protocol from the JSON body (and optional headers / path).
 * Path is a weak hint used only when the body is ambiguous.
 */
export function detectProtocol(
  body: unknown,
  headers?: Headers | Record<string, string>,
  path?: string,
): Protocol | undefined {
  const rec = asRecord(body);
  if (!rec) return undefined;

  if ("input" in rec || typeof rec.previous_response_id === "string") return "openai_responses";
  if ("instructions" in rec && !Array.isArray(rec.messages)) return "openai_responses";

  const hasMessages = Array.isArray(rec.messages);
  const anthropicVersion = Boolean(header(headers, "anthropic-version"));
  const hint = pathHint(path);

  if (Array.isArray(rec.tools)) {
    const types = rec.tools.map(toolType).filter((t): t is string => Boolean(t));
    if (types.some((t) => t === "apply_patch" || t === "local_shell" || t === "shell" || t === "custom")) {
      return hasMessages ? "openai_chat" : "openai_responses";
    }
    if (types.some((t) => t === "function") && !hasMessages) return "openai_responses";
  }

  if (hasMessages && anthropicVersion) return "anthropic_messages";

  if (hasMessages) {
    if (
      rec.stream_options != null ||
      rec.max_completion_tokens != null ||
      rec.functions != null ||
      rec.function_call != null
    ) {
      return "openai_chat";
    }
    if (
      Array.isArray(rec.tools) &&
      rec.tools.some((t) => {
        const r = asRecord(t);
        return r?.input_schema != null || (typeof r?.name === "string" && r.type == null);
      })
    ) {
      return "anthropic_messages";
    }
    for (const m of rec.messages) {
      const r = asRecord(m);
      if (!r) continue;
      if (r.tool_calls || r.role === "tool" || r.role === "function") return "openai_chat";
      const content = r.content;
      if (Array.isArray(content)) {
        for (const p of content) {
          const ty = asRecord(p)?.type;
          if (ty === "tool_use" || ty === "tool_result" || ty === "thinking" || ty === "redacted_thinking") {
            return "anthropic_messages";
          }
          if (ty === "image_url" || ty === "input_text" || ty === "input_image") return "openai_chat";
        }
      }
    }
    if (rec.stop_sequences != null || rec.thinking != null) return "anthropic_messages";
    if (typeof rec.max_tokens === "number" && rec.system != null) return "anthropic_messages";
    if (hint === "anthropic_messages" && typeof rec.max_tokens === "number") return "anthropic_messages";
    return "openai_chat";
  }

  if (hint) return hint;
  return undefined;
}
