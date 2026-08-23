import type {
  ApplyPatchOp,
  ContentPart,
  LocalShellAction,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedTool,
  ShellAction,
  ToolKind,
  ToolPayload,
} from "../events.ts";
import { OpenAIRequestError } from "../errors/openai.ts";
import { displayNameFor, stripContextSuffix } from "../models.ts";
import { asRecord } from "../record.ts";

function parseContentPart(block: unknown): ContentPart {
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
    case "input_image":
    case "image_url":
    case "image": {
      const imageUrl = b.image_url;
      const urlObj = asRecord(imageUrl);
      const url =
        (typeof imageUrl === "string" && imageUrl) ||
        (typeof urlObj?.url === "string" && urlObj.url) ||
        (typeof b.url === "string" && b.url) ||
        undefined;
      return {
        type: "image",
        mediaType: "image/png",
        source: url ? "url" : "base64",
        byteLength: 0,
        url,
      };
    }
    default:
      return { type: "unknown", vendorType: b.type, raw: block };
  }
}

function parseMessageContent(content: unknown): ContentPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (Array.isArray(content)) return content.map(parseContentPart);
  return [];
}

function applyPatchOp(raw: unknown): ApplyPatchOp {
  const rec = asRecord(raw) ?? {};
  const type = rec.type === "create_file" || rec.type === "delete_file" ? rec.type : "update_file";
  const path = typeof rec.path === "string" ? rec.path : "";
  if (type === "delete_file") return { type, path };
  return { type, path, diff: typeof rec.diff === "string" ? rec.diff : "" };
}

function localShellAction(raw: unknown): LocalShellAction {
  const rec = asRecord(raw) ?? {};
  const command = Array.isArray(rec.command)
    ? rec.command.map((c) => String(c))
    : typeof rec.command === "string"
      ? [rec.command]
      : [];
  const envRec = asRecord(rec.env) ?? {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envRec)) env[k] = String(v);
  const action: LocalShellAction = { type: "exec", command, env };
  if (typeof rec.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec.user === "string") action.user = rec.user;
  if (typeof rec.working_directory === "string") action.working_directory = rec.working_directory;
  return action;
}

function shellAction(raw: unknown): ShellAction {
  const rec = asRecord(raw) ?? {};
  const commands = Array.isArray(rec.commands)
    ? rec.commands.map((c) => String(c))
    : typeof rec.commands === "string"
      ? [rec.commands]
      : [];
  const action: ShellAction = { commands };
  if (typeof rec.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec.max_output_length === "number") action.max_output_length = rec.max_output_length;
  return action;
}

function functionPayload(name: string | undefined, argsRaw: unknown): ToolPayload {
  const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
  if (name === "apply_patch") {
    try {
      const parsed = JSON.parse(args) as unknown;
      const rec = asRecord(parsed);
      if (rec && typeof rec.input === "string") return { form: "freeform", value: rec.input };
    } catch {
      if (args.startsWith("***")) return { form: "freeform", value: args };
    }
    return { form: "freeform", value: args };
  }
  try {
    return { form: "json", value: JSON.parse(args) };
  } catch {
    return { form: "freeform", value: args };
  }
}

function toolUsePart(
  kind: ToolKind,
  opts: { id?: string; callId?: string; name?: string; payload: ToolPayload },
): ContentPart {
  const id = opts.id ?? opts.callId ?? "";
  const callId = opts.callId ?? id;
  return {
    type: "tool_use",
    kind,
    id,
    callId,
    name: opts.name,
    payload: opts.payload,
  };
}

function toolResultPart(kind: ToolKind, callId: string, output: unknown, vendorRaw: unknown): ContentPart {
  const text =
    typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
  return {
    type: "tool_result",
    kind,
    toolUseId: callId,
    callId,
    content: text ? [{ type: "text", text }] : [],
    vendorRaw,
  };
}

function messagesFromItem(item: unknown): NormalizedMessage[] {
  if (typeof item === "string") {
    return item ? [{ role: "user", parts: [{ type: "text", text: item }] }] : [];
  }
  const rec = asRecord(item);
  if (!rec) return [];
  const type = typeof rec.type === "string" ? rec.type : typeof rec.role === "string" ? "message" : "";

  switch (type) {
    case "message":
    case "": {
      const role = (typeof rec.role === "string" ? rec.role : "user") as NormalizedMessage["role"];
      return [{ role, parts: parseMessageContent(rec.content) }];
    }
    case "reasoning": {
      const id = typeof rec.id === "string" ? rec.id : "";
      const summaryRaw = Array.isArray(rec.summary) ? rec.summary : [];
      const summary = summaryRaw
        .map((s) => {
          const r = asRecord(s);
          const text = typeof r?.text === "string" ? r.text : typeof s === "string" ? s : "";
          return { type: "summary_text" as const, text };
        })
        .filter((s) => s.text.length > 0);
      return [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              id,
              summary,
              encryptedContent: typeof rec.encrypted_content === "string" ? rec.encrypted_content : undefined,
            },
          ],
        },
      ];
    }
    case "function_call": {
      const name = typeof rec.name === "string" ? rec.name : undefined;
      return [
        {
          role: "assistant",
          parts: [
            toolUsePart("openai_function", {
              id: typeof rec.id === "string" ? rec.id : undefined,
              callId: typeof rec.call_id === "string" ? rec.call_id : undefined,
              name,
              payload: functionPayload(name, rec.arguments),
            }),
          ],
        },
      ];
    }
    case "custom_tool_call": {
      const input = typeof rec.input === "string" ? rec.input : JSON.stringify(rec.input ?? "");
      return [
        {
          role: "assistant",
          parts: [
            toolUsePart("openai_custom", {
              id: typeof rec.id === "string" ? rec.id : undefined,
              callId: typeof rec.call_id === "string" ? rec.call_id : undefined,
              name: typeof rec.name === "string" ? rec.name : undefined,
              payload: { form: "freeform", value: input },
            }),
          ],
        },
      ];
    }
    case "apply_patch_call":
      return [
        {
          role: "assistant",
          parts: [
            toolUsePart("apply_patch", {
              id: typeof rec.id === "string" ? rec.id : undefined,
              callId: typeof rec.call_id === "string" ? rec.call_id : undefined,
              payload: { form: "apply_patch", operation: applyPatchOp(rec.operation) },
            }),
          ],
        },
      ];
    case "local_shell_call":
      return [
        {
          role: "assistant",
          parts: [
            toolUsePart("local_shell", {
              id: typeof rec.id === "string" ? rec.id : undefined,
              callId: typeof rec.call_id === "string" ? rec.call_id : undefined,
              payload: { form: "local_shell", action: localShellAction(rec.action) },
            }),
          ],
        },
      ];
    case "shell_call":
      return [
        {
          role: "assistant",
          parts: [
            toolUsePart("shell", {
              id: typeof rec.id === "string" ? rec.id : undefined,
              callId: typeof rec.call_id === "string" ? rec.call_id : undefined,
              payload: { form: "shell", action: shellAction(rec.action) },
            }),
          ],
        },
      ];
    case "function_call_output":
      return [
        {
          role: "tool",
          parts: [
            toolResultPart(
              "openai_function",
              typeof rec.call_id === "string" ? rec.call_id : "",
              rec.output,
              item,
            ),
          ],
        },
      ];
    case "custom_tool_call_output":
      return [
        {
          role: "tool",
          parts: [
            toolResultPart(
              "openai_custom",
              typeof rec.call_id === "string" ? rec.call_id : "",
              rec.output ?? rec.input,
              item,
            ),
          ],
        },
      ];
    case "apply_patch_call_output":
      return [
        {
          role: "tool",
          parts: [
            toolResultPart(
              "apply_patch",
              typeof rec.call_id === "string" ? rec.call_id : "",
              rec.output,
              item,
            ),
          ],
        },
      ];
    case "local_shell_call_output":
      return [
        {
          role: "tool",
          parts: [
            toolResultPart(
              "local_shell",
              typeof rec.call_id === "string" ? rec.call_id : "",
              rec.output,
              item,
            ),
          ],
        },
      ];
    case "shell_call_output":
      return [
        {
          role: "tool",
          parts: [
            toolResultPart("shell", typeof rec.call_id === "string" ? rec.call_id : "", rec.output, item),
          ],
        },
      ];
    case "item_reference":
      return [
        {
          role: "user",
          parts: [{ type: "unknown", vendorType: "item_reference", raw: item }],
        },
      ];
    default:
      return [
        {
          role: "user",
          parts: [{ type: "unknown", vendorType: type || "unknown", raw: item }],
        },
      ];
  }
}

function hasInput(rec: Record<string, unknown>): boolean {
  if (typeof rec.input === "string") return rec.input.length > 0;
  if (Array.isArray(rec.input)) return rec.input.length > 0;
  return false;
}

function parseTools(raw: unknown): { tools: NormalizedTool[]; unknown: unknown[] } {
  const tools: NormalizedTool[] = [];
  const unknown: unknown[] = [];
  if (!Array.isArray(raw)) return { tools, unknown };
  for (const item of raw) {
    const t = asRecord(item);
    if (!t || typeof t.type !== "string") {
      unknown.push(item);
      continue;
    }
    switch (t.type) {
      case "function": {
        const fn = asRecord(t.function) ?? t;
        const name = typeof fn.name === "string" ? fn.name : typeof t.name === "string" ? t.name : "";
        if (!name) continue;
        tools.push({
          kind: "openai_function",
          name,
          description: typeof fn.description === "string" ? fn.description : undefined,
          inputSchema: fn.parameters ?? t.parameters,
          vendorRaw: item,
        });
        break;
      }
      case "custom": {
        const name = typeof t.name === "string" ? t.name : "";
        if (!name) continue;
        tools.push({
          kind: "openai_custom",
          name,
          description: typeof t.description === "string" ? t.description : undefined,
          inputSchema: t.parameters,
          vendorRaw: item,
        });
        break;
      }
      case "apply_patch":
        tools.push({ kind: "apply_patch", vendorRaw: item });
        break;
      case "local_shell":
        tools.push({ kind: "local_shell", vendorRaw: item });
        break;
      case "shell":
        tools.push({ kind: "shell", vendorRaw: item });
        break;
      default:
        unknown.push(item);
    }
  }
  return { tools, unknown };
}

export function normalizeOpenAIResponsesRequest(
  body: unknown,
  opts: { defaultDisplay: string; aliases: Record<string, string> },
): NormalizedRequest {
  const rec = asRecord(body);
  if (!rec) throw new OpenAIRequestError("model: Field required", { param: "model" });
  if (typeof rec.model !== "string" || rec.model.length === 0) {
    throw new OpenAIRequestError("model: Field required", { param: "model" });
  }
  const previousResponseId = typeof rec.previous_response_id === "string" ? rec.previous_response_id : undefined;
  if (!hasInput(rec) && !previousResponseId) {
    throw new OpenAIRequestError("input is required unless previous_response_id is set", { param: "input" });
  }

  const { tools, unknown } = parseTools(rec.tools);
  if (tools.length === 0 && unknown.length > 0) {
    const types = unknown
      .map((item) => {
        const t = asRecord(item);
        return typeof t?.type === "string" ? t.type : "unknown";
      })
      .filter((v, i, a) => a.indexOf(v) === i);
    throw new OpenAIRequestError(`unsupported tool type(s): ${types.join(", ")}`, { param: "tools" });
  }

  const system: ContentPart[] = [];
  if (typeof rec.instructions === "string" && rec.instructions.length > 0) {
    system.push({ type: "text", text: rec.instructions });
  }
  for (const item of unknown) {
    system.push({ type: "unknown", vendorType: "tool", raw: item });
  }

  const messages: NormalizedMessage[] = [];
  if (typeof rec.input === "string") {
    if (rec.input.length > 0) messages.push({ role: "user", parts: [{ type: "text", text: rec.input }] });
  } else if (Array.isArray(rec.input)) {
    for (const item of rec.input) messages.push(...messagesFromItem(item));
  }

  const include = Array.isArray(rec.include)
    ? rec.include.filter((s): s is string => typeof s === "string")
    : [];

  const model = rec.model;
  const metadata = asRecord(rec.metadata) ?? {};

  return {
    protocol: "openai_responses",
    model,
    displayModel: displayNameFor(model, opts.aliases, opts.defaultDisplay),
    system,
    messages,
    tools,
    toolChoice: rec.tool_choice ?? null,
    maxTokens:
      typeof rec.max_output_tokens === "number" && Number.isFinite(rec.max_output_tokens)
        ? rec.max_output_tokens
        : undefined,
    stream: rec.stream === true,
    stopSequences: [],
    metadata,
    extras: {
      canonicalModel: stripContextSuffix(model),
      toolsRaw: rec.tools ?? [],
      instructions: typeof rec.instructions === "string" ? rec.instructions : null,
      store: rec.store === undefined ? true : rec.store === true,
      parallelToolCalls: rec.parallel_tool_calls === undefined ? true : rec.parallel_tool_calls === true,
      temperature: typeof rec.temperature === "number" ? rec.temperature : null,
      topP: typeof rec.top_p === "number" ? rec.top_p : null,
      user: typeof rec.user === "string" ? rec.user : null,
      text: rec.text ?? null,
      truncation: typeof rec.truncation === "string" ? rec.truncation : null,
      serviceTier: typeof rec.service_tier === "string" ? rec.service_tier : null,
      hasReasoningKey: Object.prototype.hasOwnProperty.call(rec, "reasoning"),
    },
    previousResponseId,
    store: rec.store === undefined ? true : rec.store === true,
    include,
    reasoning: rec.reasoning ?? null,
  };
}
