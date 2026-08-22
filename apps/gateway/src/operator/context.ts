import { estimateTextTokens, type ContentPart, type NormalizedRequest } from "@carbon-ai/protocol";

const EXCERPT = 500;
const INLINE_LIMIT = 8 * 1024;

export type ContextBlock = {
  index: number;
  role: "system" | "developer" | "user" | "assistant" | "tool";
  kind: string;
  collapsed: boolean;
  excerpt: string;
  tokenEst: number;
  truncated: boolean;
};

export type ContextPage = {
  jobId: string;
  blocks: ContextBlock[];
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

function toBlock(
  index: number,
  role: ContextBlock["role"],
  part: ContentPart,
  collapsed: boolean,
): ContextBlock {
  const raw = textOf(part);
  const truncated = raw.length > INLINE_LIMIT || raw.length > EXCERPT;
  return {
    index,
    role,
    kind: part.type,
    collapsed,
    excerpt: truncated ? raw.slice(0, EXCERPT) : raw,
    tokenEst: estimateTextTokens(raw),
    truncated,
  };
}

export function flattenContext(req: NormalizedRequest): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  const push = (role: ContextBlock["role"], part: ContentPart, collapsed: boolean): void => {
    blocks.push(toBlock(blocks.length, role, part, collapsed));
  };
  for (const part of req.system) push("system", part, true);
  if (req.tools.length > 0) {
    const names = req.tools.map((t) => ("name" in t ? t.name : t.kind)).join(", ");
    blocks.push({
      index: blocks.length,
      role: "system",
      kind: "tools",
      collapsed: true,
      excerpt: names,
      tokenEst: estimateTextTokens(names),
      truncated: false,
    });
  }
  for (const msg of req.messages) {
    const collapsed = msg.role === "system" || msg.role === "developer";
    for (const part of msg.parts) push(msg.role, part, collapsed);
  }
  return blocks;
}

export function pageContext(jobId: string, req: NormalizedRequest, cursor: string, limit: number): ContextPage {
  const all = flattenContext(req);
  const start = Math.max(0, Number.parseInt(cursor || "0", 10) || 0);
  const size = Math.min(100, Math.max(1, limit));
  const slice = all.slice(start, start + size);
  const end = start + slice.length;
  const hasMore = end < all.length;
  return {
    jobId,
    blocks: slice,
    nextCursor: hasMore ? String(end) : null,
    hasMore,
    total: all.length,
  };
}
