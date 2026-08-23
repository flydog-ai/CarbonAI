import { describe, expect, test } from "bun:test";
import { OpenAIRequestError } from "../errors/openai.ts";
import { normalizeOpenAIResponsesRequest } from "./openai-responses.ts";

const opts = { defaultDisplay: "Carbon AI", aliases: {} };

describe("normalizeOpenAIResponsesRequest", () => {
  test("requires model; input or previous_response_id", () => {
    expect(() => normalizeOpenAIResponsesRequest({}, opts)).toThrow("model: Field required");
    expect(() => normalizeOpenAIResponsesRequest({ model: "gpt-5" }, opts)).toThrow("input is required");
    const req = normalizeOpenAIResponsesRequest(
      { model: "gpt-5", previous_response_id: "resp_abc" },
      opts,
    );
    expect(req.previousResponseId).toBe("resp_abc");
    expect(req.messages).toEqual([]);
  });

  test("maps tools[] kinds and store:false", () => {
    const req = normalizeOpenAIResponsesRequest(
      {
        model: "gpt-5",
        input: "hi",
        store: false,
        reasoning: { summary: "auto" },
        include: ["reasoning.encrypted_content"],
        tools: [
          { type: "function", name: "lookup", parameters: { type: "object" } },
          { type: "custom", name: "apply_patch" },
          { type: "apply_patch" },
          { type: "local_shell" },
          { type: "shell" },
        ],
      },
      opts,
    );
    expect(req.store).toBe(false);
    expect(req.extras.store).toBe(false);
    expect(req.extras.hasReasoningKey).toBe(true);
    expect(req.tools.map((t) => t.kind)).toEqual([
      "openai_function",
      "openai_custom",
      "apply_patch",
      "local_shell",
      "shell",
    ]);
  });

  test("rejects tools[] that are only unknown kinds", () => {
    expect(() =>
      normalizeOpenAIResponsesRequest(
        { model: "m", input: "x", tools: [{ type: "web_search" }] },
        opts,
      ),
    ).toThrow("unsupported tool type(s): web_search");
  });

  test("parses function_call and function_call_output in input", () => {
    const req = normalizeOpenAIResponsesRequest(
      {
        model: "m",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] },
          { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{\"q\":1}" },
          { type: "function_call_output", call_id: "call_1", output: "ok" },
        ],
      },
      opts,
    );
    expect(req.messages).toHaveLength(3);
    expect(req.messages[1]?.parts[0]).toMatchObject({ type: "tool_use", kind: "openai_function", name: "lookup" });
    expect(req.messages[2]?.role).toBe("tool");
  });
});
