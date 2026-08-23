import { describe, expect, test } from "bun:test";
import { OpenAIResponsesAdapter } from "./openai-responses.ts";
import { emptyNormalizedRequest, type SseSink, type StreamCtx } from "../events.ts";
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
    vendorMessageId: "resp_abc",
    createdAt: 1_700_000_000_000,
    request: emptyNormalizedRequest({ protocol: "openai_responses", model: "gpt-5", extras: { store: true, toolsRaw: [] } }),
    ...over,
  };
}

function frames(buf: Buf): { event?: string; data: unknown; comment?: string }[] {
  return buf.frames.map((f) => {
    if (f.startsWith(": ")) return { comment: f.slice(2) };
    if (f.startsWith("event: ")) {
      const [evLine, dataLine] = f.split("\ndata: ");
      return { event: evLine.slice(7), data: JSON.parse(dataLine) };
    }
    if (f.startsWith("data: ")) {
      const raw = f.slice(6);
      return { data: raw === "[DONE]" ? "[DONE]" : JSON.parse(raw) };
    }
    return { data: f };
  });
}

describe("OpenAIResponsesAdapter", () => {
  test("openStream emits created then in_progress with sequence 0 and 1", async () => {
    const buf = new Buf();
    const adapter = new OpenAIResponsesAdapter();
    await adapter.openStream(ctxOf(buf));
    const parsed = frames(buf);
    expect(parsed[0]).toMatchObject({
      event: "response.created",
      data: { type: "response.created", sequence_number: 0 },
    });
    expect(parsed[1]).toMatchObject({
      event: "response.in_progress",
      data: { type: "response.in_progress", sequence_number: 1 },
    });
    const created = (parsed[0]?.data as { response: { id: string; status: string; output: unknown[]; object: string } }).response;
    expect(created.id).toBe("resp_abc");
    expect(created.object).toBe("response");
    expect(created.status).toBe("in_progress");
    expect(created.output).toEqual([]);
  });

  test("heartbeat both: comment does not consume sequence, keepalive does", async () => {
    const buf = new Buf();
    const adapter = new OpenAIResponsesAdapter({ heartbeat: "both" });
    const ctx = ctxOf(buf);
    await adapter.openStream(ctx);
    await adapter.heartbeat(ctx);
    const parsed = frames(buf);
    expect(parsed[2]).toEqual({ comment: "ping" });
    expect(parsed[3]).toMatchObject({
      event: "keepalive",
      data: { type: "keepalive", sequence_number: 2 },
    });
    const events = eventsFromBlocks({
      jobId: "job_x",
      vendorMessageId: "resp_abc",
      model: "gpt-5",
      createdAt: 1,
      inputTokens: 1,
      blocks: [{ type: "text", text: "ok" }],
    });
    for (const ev of events) await adapter.apply(ctx, ev);
    const after = frames(buf).find((f) => f.event === "response.output_item.added");
    expect((after?.data as { sequence_number: number }).sequence_number).toBe(3);
    expect(buf.frames.at(-1)).toBe("data: [DONE]");
  });

  test("event name equals JSON type; CJK in output_text.delta", async () => {
    const buf = new Buf();
    const adapter = new OpenAIResponsesAdapter();
    const ctx = ctxOf(buf);
    await adapter.openStream(ctx);
    const events = eventsFromBlocks({
      jobId: "job_x",
      vendorMessageId: "resp_abc",
      model: "gpt-5",
      createdAt: 1,
      inputTokens: 1,
      blocks: [{ type: "text", text: "你好😀" }],
    });
    for (const ev of events) await adapter.apply(ctx, ev);
    for (const f of frames(buf)) {
      if (f.event && f.data && typeof f.data === "object" && f.data !== null && "type" in f.data) {
        expect(f.event).toBe((f.data as { type: string }).type);
      }
    }
    expect(buf.frames.some((s) => s.includes("你好😀"))).toBe(true);
    expect(buf.frames.some((s) => s.includes("event: response.completed"))).toBe(true);
  });

  test("apply_patch kind emits apply_patch_call, not function_call", () => {
    const adapter = new OpenAIResponsesAdapter();
    const req = emptyNormalizedRequest({
      protocol: "openai_responses",
      model: "gpt-5",
      tools: [{ kind: "apply_patch", vendorRaw: { type: "apply_patch" } }],
      extras: { toolsRaw: [{ type: "apply_patch" }], store: true },
    });
    const events = eventsFromBlocks({
      jobId: "j",
      vendorMessageId: "resp_abc",
      model: "gpt-5",
      createdAt: 1000,
      inputTokens: 1,
      blocks: [
        {
          type: "tool_use",
          kind: "apply_patch",
          id: "apc_1",
          callId: "call_1",
          payload: {
            form: "apply_patch",
            operation: { type: "update_file", path: "lib/fib.py", diff: "@@\n-x\n+y\n" },
          },
        },
      ],
    });
    const json = adapter.toJson(fold(events), req) as { output: { type: string; operation: { path: string } }[] };
    expect(json.output[0]?.type).toBe("apply_patch_call");
    expect(json.output[0]?.operation.path).toBe("lib/fib.py");
  });

  test("function apply_patch arguments parse to {input: begin patch}", () => {
    const adapter = new OpenAIResponsesAdapter();
    const patch = "*** Begin Patch\n*** Update File: lib/fib.py\n@@\n-x\n+y\n*** End Patch\n";
    const req = emptyNormalizedRequest({
      protocol: "openai_responses",
      model: "gpt-5",
      tools: [
        {
          kind: "openai_function",
          name: "apply_patch",
          inputSchema: { type: "object", required: ["input"], properties: { input: { type: "string" } } },
          vendorRaw: {},
        },
      ],
      extras: { toolsRaw: [], store: true },
    });
    const events = eventsFromBlocks({
      jobId: "j",
      vendorMessageId: "resp_abc",
      model: "gpt-5",
      createdAt: 1000,
      inputTokens: 1,
      blocks: [
        {
          type: "tool_use",
          kind: "openai_function",
          id: "fc_1",
          callId: "call_1",
          name: "apply_patch",
          payload: { form: "freeform", value: patch },
        },
      ],
    });
    const json = adapter.toJson(fold(events), req) as { output: { type: string; arguments: string; name: string }[] };
    expect(json.output[0]?.type).toBe("function_call");
    expect(json.output[0]?.name).toBe("apply_patch");
    expect(json.output[0]?.arguments.startsWith("***")).toBe(false);
    const parsed = JSON.parse(json.output[0]!.arguments) as { input: string };
    expect(parsed.input.startsWith("*** Begin Patch")).toBe(true);
  });

  test("custom apply_patch input is the Begin Patch source", () => {
    const adapter = new OpenAIResponsesAdapter();
    const patch = "*** Begin Patch\n*** Update File: a.py\n@@\n-x\n+y\n*** End Patch\n";
    const req = emptyNormalizedRequest({
      protocol: "openai_responses",
      tools: [{ kind: "openai_custom", name: "apply_patch", vendorRaw: {} }],
      extras: { toolsRaw: [{ type: "custom", name: "apply_patch" }], store: true },
    });
    const json = adapter.toJson(
      fold(
        eventsFromBlocks({
          jobId: "j",
          vendorMessageId: "resp_abc",
          model: "gpt-5",
          createdAt: 1,
          inputTokens: 1,
          blocks: [
            {
              type: "tool_use",
              kind: "openai_custom",
              id: "ctc_1",
              callId: "call_1",
              name: "apply_patch",
              payload: { form: "freeform", value: patch },
            },
          ],
        }),
      ),
      req,
    ) as { output: { type: string; input: string }[] };
    expect(json.output[0]?.type).toBe("custom_tool_call");
    expect(json.output[0]?.input).toBe(patch);
  });

  test("local_shell_call always includes env", () => {
    const adapter = new OpenAIResponsesAdapter();
    const json = adapter.toJson(
      fold(
        eventsFromBlocks({
          jobId: "j",
          vendorMessageId: "resp_abc",
          model: "gpt-5",
          createdAt: 1,
          inputTokens: 1,
          blocks: [
            {
              type: "tool_use",
              kind: "local_shell",
              id: "lsc_1",
              callId: "call_1",
              payload: { form: "local_shell", action: { type: "exec", command: ["ls", "-l"], env: {} } },
            },
          ],
        }),
      ),
      emptyNormalizedRequest({ protocol: "openai_responses", extras: { toolsRaw: [{ type: "local_shell" }], store: true } }),
    ) as { output: { type: string; action: { env: unknown; type: string } }[] };
    expect(json.output[0]?.type).toBe("local_shell_call");
    expect(json.output[0]?.action.type).toBe("exec");
    expect(json.output[0]?.action.env).toEqual({});
  });

  test("YouResponse never omits required keys", () => {
    const adapter = new OpenAIResponsesAdapter();
    const json = adapter.toJson(
      fold(
        eventsFromBlocks({
          jobId: "j",
          vendorMessageId: "resp_abc",
          model: "gpt-5",
          createdAt: 1,
          inputTokens: 2,
          blocks: [{ type: "text", text: "ok" }],
        }),
      ),
      emptyNormalizedRequest({
        protocol: "openai_responses",
        extras: { toolsRaw: [], store: false, parallelToolCalls: true, instructions: null },
        store: false,
      }),
    ) as Record<string, unknown>;
    for (const key of [
      "id",
      "object",
      "created_at",
      "status",
      "error",
      "incomplete_details",
      "instructions",
      "max_output_tokens",
      "model",
      "output",
      "parallel_tool_calls",
      "previous_response_id",
      "reasoning",
      "store",
      "temperature",
      "tool_choice",
      "tools",
      "top_p",
      "truncation",
      "usage",
      "user",
      "metadata",
      "text",
      "service_tier",
    ]) {
      expect(key in json).toBe(true);
    }
    expect(json.store).toBe(false);
    expect(json.status).toBe("completed");
  });
});
