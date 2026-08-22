import type { NormalizedMessage, NormalizedRequest } from "./events.ts";
import { isNoiseUserText } from "./tokens.ts";

export type ConversationTurn = {
  role: string;
  text: string;
};

function messageText(m: NormalizedMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** User/assistant turns with Claude Code system-reminders stripped. */
export function conversationTurns(req: NormalizedRequest): ConversationTurn[] {
  const out: ConversationTurn[] = [];
  for (const m of req.messages) {
    const text = messageText(m);
    if (m.role === "user" && isNoiseUserText(text)) continue;
    out.push({ role: m.role, text });
  }
  return out;
}

/** True when `next` is the same chat as `prev` plus at least one new turn. */
export function isConversationContinuation(prev: NormalizedRequest, next: NormalizedRequest): boolean {
  const a = conversationTurns(prev);
  const b = conversationTurns(next);
  if (a.length === 0 || b.length <= a.length) return false;
  return a.every((t, i) => t.role === b[i]?.role && t.text === b[i]?.text);
}
