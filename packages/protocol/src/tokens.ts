import type { ContentPart, NormalizedMessage, NormalizedRequest } from "./events.ts";

export function estimateTextTokens(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    n += cp >= 0x2e80 && cp <= 0x9fff ? 1 / 1.5 : 1 / 4;
  }
  return Math.max(0, Math.round(n));
}

function estimatePart(part: ContentPart): number {
  switch (part.type) {
    case "text":
      return estimateTextTokens(part.text);
    case "image":
      return 1600;
    case "document":
      return estimateTextTokens(part.excerpt ?? "") + 200;
    case "thinking":
      return estimateTextTokens(part.thinking);
    case "redacted_thinking":
      return 8;
    case "reasoning":
      return part.summary.reduce((acc, s) => acc + estimateTextTokens(s.text), 0);
    case "tool_use":
      return estimateTextTokens(JSON.stringify(part.payload)) + estimateTextTokens(part.name ?? "");
    case "tool_result":
      return part.content.reduce((acc, p) => acc + estimatePart(p), 0);
    case "unknown":
      return 16;
  }
}

export function estimateRequestTokens(req: NormalizedRequest): number {
  const sys = req.system.reduce((acc, p) => acc + estimatePart(p), 0);
  const msgs = req.messages.reduce(
    (acc, m: NormalizedMessage) => acc + m.parts.reduce((a, p) => a + estimatePart(p), 0),
    0,
  );
  return Math.max(1, sys + msgs);
}

function isNoiseUserText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<system-reminder>") || t.startsWith("<system-reminder");
}

export function lastUserPreview(req: NormalizedRequest, max = 200): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role !== "user") continue;
    const text = m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    if (!text || isNoiseUserText(text)) continue;
    return text.length <= max ? text : text.slice(0, max);
  }
  return "";
}

export function toolNames(req: NormalizedRequest): string[] {
  return req.tools.map((t) => ("name" in t ? t.name : t.kind));
}
