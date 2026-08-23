import { describe, expect, test } from "bun:test";
import { OpenAIRequestError } from "../errors/openai.ts";
import { normalizeOpenAIChatRequest } from "./openai-chat.ts";

const opts = { defaultDisplay: "Carbon AI", aliases: { "gpt-5": "Carbon AI (GPT slot)" } };

describe("normalizeOpenAIChatRequest", () => {
  test("requires model and messages", () => {
    expect(() => normalizeOpenAIChatRequest({}, opts)).toThrow(OpenAIRequestError);
    expect(() => normalizeOpenAIChatRequest({ model: "gpt-5" }, opts)).toThrow("messages: Field required");
  });

  test("maps alias display and functions[] into openai_function tools", () => {
    const req = normalizeOpenAIChatRequest(
      {
        model: "gpt-5",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        stream_options: { include_usage: true },
        functions: [{ name: "lookup", parameters: { type: "object" } }],
      },
      opts,
    );
    expect(req.protocol).toBe("openai_chat");
    expect(req.displayModel).toBe("Carbon AI (GPT slot)");
    expect(req.stream).toBe(true);
    expect(req.extras.includeUsage).toBe(true);
    expect(req.tools).toEqual([
      expect.objectContaining({ kind: "openai_function", name: "lookup" }),
    ]);
  });

  test("parses assistant tool_calls and tool results", () => {
    const req = normalizeOpenAIChatRequest(
      {
        model: "m",
        messages: [
          { role: "user", content: "patch it" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** End Patch\n" }) },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "ok" },
        ],
      },
      opts,
    );
    const assistant = req.messages[1];
    const tool = assistant?.parts.find((p) => p.type === "tool_use");
    expect(tool).toMatchObject({ type: "tool_use", kind: "openai_function", name: "apply_patch" });
    if (tool?.type === "tool_use") {
      expect(tool.payload).toEqual({ form: "freeform", value: "*** Begin Patch\n*** End Patch\n" });
    }
    expect(req.messages[2]?.role).toBe("tool");
  });
});
