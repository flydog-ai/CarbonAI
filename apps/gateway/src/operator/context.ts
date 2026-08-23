import {
  estimateTextTokens,
  isMetaTag,
  parseEnvPairs,
  splitMarkup,
  type AssistantOutput,
  type ContentPart,
  type NormalizedRequest,
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
  fields?: { key: string; value: string }[];
};

export type ContextPage = {
  jobId: string;
  system: ContextBlock[];
  blocks: ContextBlock[];
  reply: ContextBlock[];
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
      return `${part.name ?? part.kind} ${JSON.stringify(part.payload)}`;
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
  opts: { collapsed?: boolean; title?: string; source?: "request" | "reply"; max?: number } = {},
): ContextBlock {
  const max = opts.max ?? (laneFor(role, kind) === "user" || laneFor(role, kind) === "assistant" ? INLINE_LIMIT : SYS_EXCERPT);
  const { excerpt, truncated } = clip(raw, Math.min(max, INLINE_LIMIT));
  const fields = fieldsFor(kind, raw);
  return {
    index,
    role,
    kind,
    lane: laneFor(role, kind),
    title: opts.title,
    collapsed: opts.collapsed ?? (laneFor(role, kind) === "system" || laneFor(role, kind) === "meta"),
    excerpt,
    tokenEst: estimateTextTokens(raw),
    truncated,
    source: opts.source ?? "request",
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
    blocks.push(
      makeBlock(blocks.length, roleForPart, kind, textOf(part), {
        collapsed: kind === "thinking" || kind === "reasoning" || collapsed,
        source,
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
        makeBlock(blocks.length, "assistant", "tool_use", `${b.name ?? b.kind} ${JSON.stringify(b.payload)}`, {
          source: "reply",
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
    nextCursor: hasMore ? String(end) : null,
    hasMore,
    total: chat.length,
  };
}
