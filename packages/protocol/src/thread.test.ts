import { describe, expect, test } from "bun:test";
import { emptyNormalizedRequest } from "./events.ts";
import { conversationTurns, isConversationContinuation } from "./thread.ts";

function req(messages: { role: "user" | "assistant"; text: string }[]) {
  return emptyNormalizedRequest({
    messages: messages.map((m) => ({
      role: m.role,
      parts: [{ type: "text", text: m.text }],
    })),
  });
}

describe("conversationTurns", () => {
  test("drops system-reminder user blocks", () => {
    const n = req([
      { role: "user", text: "<system-reminder>\nhide me\n</system-reminder>" },
      { role: "user", text: "hello" },
    ]);
    expect(conversationTurns(n).map((t) => t.text)).toEqual(["hello"]);
  });

  test("keeps the user sentence after a system-reminder", () => {
    const n = req([
      {
        role: "user",
        text: "<system-reminder>\nhide me\n</system-reminder>\nplease fix the login form",
      },
    ]);
    expect(conversationTurns(n).map((t) => t.text)).toEqual(["please fix the login form"]);
  });
});

describe("isConversationContinuation", () => {
  test("next turn with assistant reply is the same thread", () => {
    const first = req([{ role: "user", text: "hello" }]);
    const second = req([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
      { role: "user", text: "what next" },
    ]);
    expect(isConversationContinuation(first, second)).toBe(true);
    expect(isConversationContinuation(second, first)).toBe(false);
  });

  test("unrelated first messages are not a continuation", () => {
    const a = req([{ role: "user", text: "hello" }]);
    const b = req([{ role: "user", text: "other chat" }]);
    expect(isConversationContinuation(a, b)).toBe(false);
  });
});
