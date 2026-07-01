import type { AssistantOutput, InternalEvent, NormalizedRequest, ProtocolAdapter, StreamCtx } from "@carbon-ai/protocol";

/** Debug/test adapter: InternalEvent as JSON data frames, terminate with [DONE]. */
export class TestAdapter implements ProtocolAdapter {
  protocol = "anthropic_messages" as const;

  constructor(private readonly writeDelayMs = 0) {}

  private async pause(): Promise<void> {
    if (this.writeDelayMs > 0) await Bun.sleep(this.writeDelayMs);
  }

  async openStream(ctx: StreamCtx): Promise<void> {
    await this.pause();
    await ctx.writer.data(JSON.stringify({ type: "open", id: ctx.jobId }));
  }

  async apply(ctx: StreamCtx, ev: InternalEvent): Promise<void> {
    await this.pause();
    await ctx.writer.data(JSON.stringify(ev));
  }

  async heartbeat(ctx: StreamCtx): Promise<void> {
    await ctx.writer.comment("ping");
  }

  async closeStream(ctx: StreamCtx): Promise<void> {
    await this.pause();
    await ctx.writer.data("[DONE]");
    await ctx.writer.drain();
  }

  toJson(output: AssistantOutput, _req: NormalizedRequest): unknown {
    return output;
  }
}
