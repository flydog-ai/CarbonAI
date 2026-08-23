import { describe, expect, test } from "bun:test";
import { OpenAIChatAdapter } from "./openai-chat.ts";
import { emptyNormalizedRequest, type InternalEvent, type SseSink, type StreamCtx } from "../events.ts";
import { eventsFromBlocks } from "../events-from-blocks.ts";
import { fold } from "../fold.ts";

class Buf implements SseSink {
  frames: string[] = [];
  async comment(s: string): Promise<void> {
    this.frames.push(`: ${s}`);
  }
  async data(payload: string): Promise<void> {
    this.frames.push(`data: ${payload}`);
  }
  async event(name: string, payload: unknown): Promise<void> {
    this.frames.push(`event: ${name}\ndata: ${JSON.stringify(payload)}`);
  }
  async drain(): Promise<void> {}
}

function ctxOf(buf: Buf, over: Partial<StreamCtx> = {}): StreamCtx {
  return {
    jobId: "job_x",
    writer: buf,
    vendorMessageId: "chatcmpl-abc",
    createdAt: 1_700_000_000_000,
    request: emptyNormalizedRequest({ protocol: "openai_chat", model: "gpt-5" }),
    ...over,
  };
}

function parseData(frames: string[]): unknown[] {
  return frames
    .filter((f) => f.startsWith("data: ") && f !== "data: [DONE]")
    .map((f) => JSON.parse(f.slice(6)) as unknown);
}

describe("OpenAIChatAdapter", () => {
  test("openStream role delta has no content key", async () => {
    const buf = new Buf();
    const adapter = new OpenAIChatAdapter();
    await adapter.openStream(ctxOf(buf));
    const first = parseData(buf.frames)[0] as { choices: { delta: Record<string, unknown> }[] };
    expect(first.choices[0]?.delta).toEqual({ role: "assistant" });
    expect("content" in (first.choices[0]?.delta ?? {})).toBe(false);
    expect(buf.frames.some((f) => f.startsWith("event:"))).toBe(false);
  });

  test("text then stop then [DONE]; CJK preserved", async () => {
    const buf = new Buf();
    const adapter = new OpenAIChatAdapter();
    const ctx = ctxOf(buf);
    await adapter.openStream(ctx);
    const events = eventsFromBlocks({
      jobId: "job_x",
      vendorMessageId: "chatcmpl-abc",
      model: "gpt-5",
      createdAt: 1,
      inputTokens: 2,
      blocks: [{ type: "text", text: "你好😀" }],
    });
    for (const ev of events) await adapter.apply(ctx, ev);
    expect(buf.frames.some((f) => f.includes("你好😀"))).toBe(true);
    expect(buf.frames.at(-1)).toBe("data: [DONE]");
    const chunks = parseData(buf.frames) as { choices: { delta: { content?: string }; finish_reason: string | null }[] }[];
    expect(chunks.some((c) => c.choices[0]?.delta.content === "你好😀")).toBe(true);
    expect(chunks.some((c) => c.choices[0]?.finish_reason === "stop")).toBe(true);
  });

  test("tool-only JSON content is null; apply_patch arguments are object JSON", () => {
    const adapter = new OpenAIChatAdapter();
    const req = emptyNormalizedRequest({
      protocol: "openai_chat",
      model: "gpt-5",
      tools: [
        {
          kind: "openai_function",
          name: "apply_patch",
          inputSchema: { type: "object", required: ["input"], properties: { input: { type: "string" } } },
          vendorRaw: {},
        },
      ],
    });
    const events = eventsFromBlocks({
      jobId: "j",
      vendorMessageId: "chatcmpl-abc",
      model: "gpt-5",
      createdAt: 1000,
      inputTokens: 3,
      blocks: [
        {
          type: "tool_use",
          kind: "openai_function",
          id: "call_1",
          callId: "call_1",
          name: "apply_patch",
          payload: { form: "freeform", value: "*** Begin Patch\n*** Update File: a.py\n@@\n-x\n+y\n*** End Patch\n" },
        },
      ],
    });
    const json = adapter.toJson(fold(events), req) as {
      choices: { message: { content: unknown; tool_calls: { function: { arguments: string } }[] }; finish_reason: string }[];
    };
    expect(json.choices[0]?.message.content).toBeNull();
    expect(json.choices[0]?.finish_reason).toBe("tool_calls");
    const args = json.choices[0]?.message.tool_calls[0]?.function.arguments ?? "";
    expect(args.startsWith("***")).toBe(false);
    const parsed = JSON.parse(args) as { input: string };
    expect(typeof parsed.input).toBe("string");
    expect(parsed.input.startsWith("*** Begin Patch")).toBe(true);
  });

  test("include_usage puts usage:null on every chunk and a usage trailer", async () => {
    const buf = new Buf();
    const adapter = new OpenAIChatAdapter();
    const ctx = ctxOf(buf, {
      request: emptyNormalizedRequest({ protocol: "openai_chat", model: "gpt-5", extras: { includeUsage: true } }),
    });
    await adapter.openStream(ctx);
    const events: InternalEvent[] = eventsFromBlocks({
      jobId: "job_x",
      vendorMessageId: "chatcmpl-abc",
      model: "gpt-5",
      createdAt: 1,
      inputTokens: 4,
      blocks: [{ type: "text", text: "ok" }],
    });
    for (const ev of events) await adapter.apply(ctx, ev);
    const chunks = parseData(buf.frames) as { choices: unknown[]; usage: unknown }[];
    const withChoices = chunks.filter((c) => Array.isArray(c.choices) && c.choices.length > 0);
    expect(withChoices.every((c) => c.usage === null)).toBe(true);
    const trailer = chunks.find((c) => Array.isArray(c.choices) && c.choices.length === 0);
    expect(trailer?.usage).toMatchObject({ prompt_tokens: 4 });
    expect(buf.frames.at(-1)).toBe("data: [DONE]");
  });

  test("midstream error writes exact bytes and no [DONE]", async () => {
    const buf = new Buf();
    const adapter = new OpenAIChatAdapter();
    const ctx = ctxOf(buf);
    await adapter.openStream(ctx);
    await adapter.apply(ctx, { type: "error", code: "timeout", message: "Carbon AI operator wait timeout" });
    expect(buf.frames.some((f) => f === "data: [DONE]")).toBe(false);
    const errLine = buf.frames.find((f) => f.includes('"error"'));
    expect(errLine).toBe(
      'data: {"error":{"message":"Carbon AI operator wait timeout","type":"server_error","param":null,"code":"timeout"}}',
    );
  });
});
