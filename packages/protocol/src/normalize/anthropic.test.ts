import { describe, expect, test } from "bun:test";
import { AnthropicRequestError } from "../errors/anthropic.ts";
import { normalizeAnthropicRequest } from "./anthropic.ts";

const aliases = { "claude-sonnet-4-6": "You (Sonnet slot)" };

describe("normalizeAnthropicRequest", () => {
  test("requires model, messages, max_tokens", () => {
    expect(() => normalizeAnthropicRequest({}, { defaultDisplay: "Carbon AI", aliases })).toThrow(
      AnthropicRequestError,
    );
    expect(() =>
      normalizeAnthropicRequest({ model: "x", messages: [{ role: "user", content: "hi" }] }, {
        defaultDisplay: "Carbon AI",
        aliases,
      }),
    ).toThrow("max_tokens: Field required");
  });

  test("accepts any model string and maps alias display", () => {
    const req = normalizeAnthropicRequest(
      {
        model: "claude-sonnet-4-6[1m]",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
      { defaultDisplay: "Carbon AI", aliases },
    );
    expect(req.model).toBe("claude-sonnet-4-6[1m]");
    expect(req.displayModel).toBe("You (Sonnet slot)");
    expect(req.stream).toBe(true);
    expect(req.messages[0]?.parts).toEqual([{ type: "text", text: "hi" }]);
  });
});
