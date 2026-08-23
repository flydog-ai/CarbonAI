import {
  estimateTextTokens,
  isMetaTag,
  parseEnvPairs,
  payloadPreview,
  publicTools,
  splitMarkup,
  type AssistantOutput,
  type ContentPart,
  type NormalizedRequest,
  type PublicTool,
  type ToolPayload,
} from "@carbon-ai/protocol";

const SYS_EXCERPT = 500;
const INLINE_LIMIT = 8 * 1024;

export type ContextLane = "system" | "user" | "assistant" | "tool" | "meta";

export type ContextBlock = {
  index: number;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  kind: string;
  lane: ContextLane;
  title?: string;
  collapsed: boolean;
  excerpt: string;
  tokenEst: number;
  truncated: boolean;
  source: "request" | "reply";
  status?: "ok" | "error";
  fields?: { key: string; value: string }[];
};

export type ContextPage = {
  jobId: string;
  system: ContextBlock[];
  blocks: ContextBlock[];
  reply: ContextBlock[];
  tools: PublicTool[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
};

function textOf(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "thinking":
      return part.thinking;
    case "tool_use":
      return payloadPreview(part.payload);
    case "tool_result":
      return part.content.map(textOf).join("\n");
    case "image":
      return `[image ${part.mediaType} ${part.byteLength} bytes]`;
    case "document":
      return `[document ${part.title ?? part.mediaType}]`;
    case "reasoning":
      return part.summary.map((s) => s.text).join("\n");
    case "redacted_thinking":
      return "[redacted thinking]";
    case "unknown":
      return `[${part.vendorType}]`;
  }
}

function clip(raw: string, max: number): { excerpt: string; truncated: boolean } {
  const truncated = raw.length > max;
  return { excerpt: truncated ? raw.slice(0, max) : raw, truncated };
}

function laneFor(role: ContextBlock["role"], kind: string): ContextLane {
  if (kind === "tools") return "system";
  if (isMetaTag(kind)) return "meta";
  if (role === "system" || role === "developer") return "system";
  if (role === "tool" || kind === "tool_use" || kind === "tool_result") return "tool";
  if (role === "assistant") return "assistant";
  return "user";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function objectFields(value: unknown): { key: string; value: string }[] | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const rows = Object.entries(rec).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v),
  }));
  return rows.length ? rows : undefined;
}

export function fieldsFromPayload(payload: ToolPayload): { key: string; value: string }[] | undefined {
  switch (payload.form) {
    case "json":
      return objectFields(payload.value);
    case "apply_patch": {
      const op = payload.operation;
      const rows = [
        { key: "type", value: op.type },
        { key: "path", value: op.path },
      ];
      if ("diff" in op && op.diff) rows.push({ key: "diff", value: op.diff });
      return rows;
    }
    case "local_shell":
      return objectFields(payload.action);
    case "shell":
      return objectFields(payload.action);
    case "freeform":
      return undefined;
  }
}

function reminderInner(raw: string): { excerpt: string; fields?: { key: string; value: string }[] } {
  const segs = splitMarkup(raw);
  const fields: { key: string; value: string }[] = [];
  const prose: string[] = [];
  for (const s of segs) {
    if (s.kind === "text") {
      const body = s.text.replace(/^\n+|\n+$/g, "");
      if (body.trim()) prose.push(body);
      continue;
    }
    fields.push({ key: s.name ?? "tag", value: s.text.trim() });
  }
  if (!fields.length) return { excerpt: raw };
  return { excerpt: prose.join("\n"), fields };
}

function resultShape(raw: string, isError?: boolean): { excerpt: string; status?: "ok" | "error" } {
  const segs = splitMarkup(raw);
  const err = segs.find((s) => s.kind === "tag" && (s.name === "tool_use_error" || s.name === "error"));
  if (err) return { excerpt: err.text.trim() || raw, status: "error" };
  if (isError) return { excerpt: raw, status: "error" };
  if (/not found|error:/i.test(raw)) return { excerpt: raw, status: "error" };
  return { excerpt: raw, status: "ok" };
}

function fieldsFor(kind: string, raw: string): { key: string; value: string }[] | undefined {
  const k = kind.toLowerCase();
  if (k === "env" || k === "user_info" || k === "user-info") {
    const pairs = parseEnvPairs(raw);
    return pairs.length ? pairs : undefined;
  }
  return undefined;
}

function makeBlock(
  index: number,
  role: ContextBlock["role"],
  kind: string,
  raw: string,
  opts: {
    collapsed?: boolean;
    title?: string;
    source?: "request" | "reply";
    max?: number;
    fields?: { key: string; value: string }[];
    status?: "ok" | "error";
  } = {},
): ContextBlock {
  const lane = laneFor(role, kind);
  let excerptSrc = raw;
  let fields = opts.fields ?? fieldsFor(kind, raw);
  if (kind === "system-reminder") {
    const inner = reminderInner(raw);
    excerptSrc = inner.excerpt;
    fields = opts.fields ?? inner.fields;
  }
  const max = opts.max ?? (lane === "user" || lane === "assistant" ? INLINE_LIMIT : SYS_EXCERPT);
  const { excerpt, truncated } = clip(excerptSrc, Math.min(max, INLINE_LIMIT));
  const autoCollapse = lane === "system" || lane === "meta";
  const shortMeta = kind === "system-reminder" && excerptSrc.length < 280;
  const collapse = opts.collapsed ?? autoCollapse;
  return {
    index,
    role,
    kind,
    lane,
    title: opts.title,
    collapsed: collapse && !shortMeta,
    excerpt,
    tokenEst: estimateTextTokens(raw),
    truncated,
    source: opts.source ?? "request",
    ...(opts.status ? { status: opts.status } : {}),
    ...(fields ? { fields } : {}),
  };
}

const COMMAND_FOLLOW = new Set(["command-message", "command-args"]);

function coalesceCommands(blocks: ContextBlock[]): ContextBlock[] {
  const out: ContextBlock[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (last && (last.kind === "command-name" || last.kind === "command") && COMMAND_FOLLOW.has(b.kind)) {
      const line = b.kind === "command-args" ? (b.excerpt ? `args ${b.excerpt}` : "") : b.excerpt;
      last.kind = "command";
      last.title = "command-name";
      last.excerpt = [last.excerpt, line].filter(Boolean).join("\n");
      last.collapsed = false;
      continue;
    }
    out.push({ ...b, index: out.length });
  }
  return out;
}

function pushText(
  blocks: ContextBlock[],
  role: ContextBlock["role"],
  part: ContentPart,
  collapsed: boolean,
  source: "request" | "reply",
): void {
  if (part.type !== "text") {
    const kind = part.type;
    const roleForPart: ContextBlock["role"] =
      kind === "tool_result" ? "tool" : kind === "tool_use" ? "assistant" : role;
    const title =
      kind === "tool_use" ? (part.name ?? part.kind) : kind === "tool_result" ? "tool_result" : undefined;
    const result = kind === "tool_result" ? resultShape(textOf(part), part.isError) : undefined;
    const raw = result?.excerpt ?? textOf(part);
    blocks.push(
      makeBlock(blocks.length, roleForPart, kind, raw, {
        collapsed: kind === "thinking" || kind === "reasoning" || collapsed,
        title,
        source,
        max: kind === "tool_use" || kind === "tool_result" ? INLINE_LIMIT : undefined,
        fields: kind === "tool_use" ? fieldsFromPayload(part.payload) : undefined,
        status: result?.status,
      }),
    );
    return;
  }
  const segs = splitMarkup(part.text);
  const onlyPlain = segs.length === 1 && segs[0]?.kind === "text";
  if (onlyPlain) {
    blocks.push(makeBlock(blocks.length, role, "text", part.text, { collapsed, source }));
    return;
  }
  for (const seg of segs) {
    if (seg.kind === "text") {
      const body = seg.text.replace(/^\n+|\n+$/g, "");
      if (!body.trim()) continue;
      blocks.push(makeBlock(blocks.length, role, "text", body, { collapsed: false, source }));
      continue;
    }
    const name = seg.name ?? "tag";
    const meta = isMetaTag(name);
    blocks.push(
      makeBlock(blocks.length, meta ? "system" : role, name, seg.text.replace(/^\n+|\n+$/g, ""), {
        collapsed: meta,
        title: name,
        source,
      }),
    );
  }
}

export function flattenSystem(req: NormalizedRequest): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  for (const part of req.system) pushText(blocks, "system", part, true, "request");
  if (req.tools.length > 0) {
    const names = req.tools.map((t) => ("name" in t ? t.name : t.kind)).join(", ");
    blocks.push(makeBlock(blocks.length, "system", "tools", names, { collapsed: true, title: "tools" }));
  }
  return coalesceCommands(blocks);
}

export function flattenMessages(req: NormalizedRequest): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  for (const msg of req.messages) {
    const collapsed = msg.role === "system" || msg.role === "developer";
    for (const part of msg.parts) pushText(blocks, msg.role, part, collapsed, "request");
  }
  return coalesceCommands(blocks);
}

export function flattenReply(output: AssistantOutput | undefined): ContextBlock[] {
  if (!output?.blocks.length) return [];
  const blocks: ContextBlock[] = [];
  for (const b of output.blocks) {
    if (b.type === "text") {
      pushText(blocks, "assistant", b, false, "reply");
    } else if (b.type === "thinking") {
      blocks.push(makeBlock(blocks.length, "assistant", "thinking", b.thinking, { collapsed: true, source: "reply" }));
    } else if (b.type === "reasoning") {
      blocks.push(
        makeBlock(blocks.length, "assistant", "reasoning", b.summary.map((s) => s.text).join("\n"), {
          collapsed: true,
          source: "reply",
        }),
      );
    } else {
      blocks.push(
        makeBlock(blocks.length, "assistant", "tool_use", payloadPreview(b.payload), {
          title: b.name ?? b.kind,
          source: "reply",
          max: INLINE_LIMIT,
          fields: fieldsFromPayload(b.payload),
        }),
      );
    }
  }
  return blocks;
}

export function flattenContext(req: NormalizedRequest, output?: AssistantOutput): ContextBlock[] {
  return [...flattenSystem(req), ...flattenMessages(req), ...flattenReply(output)];
}

export function pageContext(
  jobId: string,
  req: NormalizedRequest,
  cursor: string,
  limit: number,
  output?: AssistantOutput,
  opts: { tail?: boolean } = {},
): ContextPage {
  const system = flattenSystem(req);
  const chat = flattenMessages(req);
  const reply = flattenReply(output);
  const size = Math.min(100, Math.max(1, limit));
  if (opts.tail) {
    const parsed = Number.parseInt(cursor, 10);
    const useLatest = !cursor || cursor === "0" || !Number.isFinite(parsed);
    const end = useLatest ? chat.length : Math.min(chat.length, Math.max(0, parsed));
    const start = Math.max(0, end - size);
    const slice = chat.slice(start, end);
    return {
      jobId,
      system,
      blocks: slice,
      reply: end >= chat.length ? reply : [],
      tools: publicTools(req.tools),
      nextCursor: start > 0 ? String(start) : null,
      hasMore: start > 0,
      total: chat.length,
    };
  }
  const start = Math.max(0, Number.parseInt(cursor || "0", 10) || 0);
  const slice = chat.slice(start, start + size);
  const end = start + slice.length;
  const hasMore = end < chat.length;
  return {
    jobId,
    system,
    blocks: slice,
    reply: hasMore ? [] : reply,
    tools: publicTools(req.tools),
    nextCursor: hasMore ? String(end) : null,
    hasMore,
    total: chat.length,
  };
}
