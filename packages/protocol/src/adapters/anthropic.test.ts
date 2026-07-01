import { describe, expect, test } from "bun:test";
import { AnthropicAdapter } from "./anthropic.ts";
import { emptyNormalizedRequest, type InternalEvent, type SseSink, type StreamCtx } from "../events.ts";

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

describe("AnthropicAdapter", () => {
  test("openStream emits message_start and ping before any operator text", async () => {
    const buf = new Buf();
    const adapter = new AnthropicAdapter();
    const ctx: StreamCtx = {
      jobId: "job_x",
      writer: buf,
      vendorMessageId: "msg_01abc",
      request: emptyNormalizedRequest({ model: "carbon-default", messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] }),
    };
    await adapter.openStream(ctx);
    expect(buf.frames[0]).toContain("event: message_start");
    expect(buf.frames[0]).toContain("\"model\":\"carbon-default\"");
    expect(buf.frames.some((f) => f.startsWith(": ping"))).toBe(true);
    expect(buf.frames.some((f) => f.includes("event: ping"))).toBe(true);
  });

  test("text events then stop", async () => {
    const buf = new Buf();
    const adapter = new AnthropicAdapter();
    const ctx: StreamCtx = {
      jobId: "job_x",
      writer: buf,
      vendorMessageId: "msg_01abc",
      request: emptyNormalizedRequest({ model: "carbon-default" }),
    };
    await adapter.openStream(ctx);
    const events: InternalEvent[] = [
      { type: "job_start", jobId: "job_x", vendorMessageId: "msg_01abc", model: "carbon-default", createdAt: 1, inputTokens: 2 },
      { type: "text_start", blockIndex: 0 },
      { type: "text_delta", blockIndex: 0, text: "ok" },
      { type: "text_end", blockIndex: 0 },
      { type: "stop", reason: "end_turn", stopSequence: null, outputTokens: 1, inputTokens: 2 },
    ];
    for (const ev of events) await adapter.apply(ctx, ev);
    expect(buf.frames.filter((f) => f.includes("message_start")).length).toBe(1);
    expect(buf.frames.some((f) => f.includes("text_delta") && f.includes("ok"))).toBe(true);
    expect(buf.frames.some((f) => f.includes("message_stop"))).toBe(true);
  });
});
