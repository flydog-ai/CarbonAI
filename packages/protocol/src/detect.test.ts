import { describe, expect, test } from "bun:test";
import { detectProtocol } from "./detect.ts";

describe("detectProtocol", () => {
  test("Responses: input or previous_response_id", () => {
    expect(detectProtocol({ model: "gpt-5", input: "hi" })).toBe("openai_responses");
    expect(detectProtocol({ model: "gpt-5", previous_response_id: "resp_x" })).toBe("openai_responses");
    expect(detectProtocol({ model: "gpt-5", instructions: "be brief" })).toBe("openai_responses");
  });

  test("Anthropic: anthropic-version header wins on messages", () => {
    expect(
      detectProtocol(
        { model: "claude-sonnet-4-6", max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
        { "anthropic-version": "2023-06-01" },
      ),
    ).toBe("anthropic_messages");
  });

  test("Chat Completions: messages without Anthropic header", () => {
    expect(detectProtocol({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] })).toBe("openai_chat");
    expect(
      detectProtocol({
        model: "gpt-5",
        messages: [{ role: "user", content: "hi" }],
        stream_options: { include_usage: true },
      }),
    ).toBe("openai_chat");
  });

  test("Anthropic tools with input_schema", () => {
    expect(
      detectProtocol({
        model: "m",
        max_tokens: 32,
        messages: [{ role: "user", content: "run" }],
        tools: [{ name: "Bash", input_schema: { type: "object" } }],
      }),
    ).toBe("anthropic_messages");
  });

  test("path is only a hint when the body is ambiguous", () => {
    const anth = { model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
    expect(detectProtocol(anth, {}, "/v1/messages")).toBe("anthropic_messages");
    expect(detectProtocol({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] }, {}, "/v1/messages")).toBe(
      "openai_chat",
    );
    expect(detectProtocol({ model: "gpt-5", input: "x" }, {}, "/v1/chat/completions")).toBe("openai_responses");
    expect(detectProtocol({ model: "gpt-5" }, {}, "/v1/chat/completions")).toBe("openai_chat");
  });
});
