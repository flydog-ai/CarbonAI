import type {
  AssistantBlock,
  AssistantOutput,
  InternalEvent,
  NormalizedRequest,
  ProtocolAdapter,
  StreamCtx,
  ToolPayload,
} from "../events.ts";
import { estimateRequestTokens } from "../tokens.ts";

function usageZero(inputTokens: number, outputTokens: number): Record<string, number> {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function jsonDelta(payload: ToolPayload): string {
  switch (payload.form) {
    case "json":
      return JSON.stringify(payload.value ?? {});
    case "freeform":
      return payload.value;
    case "apply_patch":
      return JSON.stringify(payload.operation);
    case "local_shell":
      return JSON.stringify(payload.action);
    case "shell":
      return JSON.stringify(payload.action);
  }
}

function blockToAnthropic(block: AssistantBlock): unknown {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name ?? "",
        input: block.payload.form === "json" ? block.payload.value : jsonDelta(block.payload),
      };
    case "reasoning":
      return null;
  }
}

export class AnthropicAdapter implements ProtocolAdapter {
  protocol = "anthropic_messages" as const;
  private started = false;

  async openStream(ctx: StreamCtx): Promise<void> {
    const inputTokens = estimateRequestTokens(ctx.request);
    await ctx.writer.event("message_start", {
      type: "message_start",
      message: {
        id: ctx.vendorMessageId,
        type: "message",
        role: "assistant",
        content: [],
        model: ctx.request.model,
        stop_reason: null,
        stop_sequence: null,
        usage: usageZero(inputTokens, 1),
      },
    });
    await ctx.writer.comment("ping");
    await ctx.writer.event("ping", { type: "ping" });
    this.started = true;
  }

  async apply(ctx: StreamCtx, ev: InternalEvent): Promise<void> {
    switch (ev.type) {
      case "job_start":
        if (!this.started) await this.openStream(ctx);
        return;
      case "text_start":
        await ctx.writer.event("content_block_start", {
          type: "content_block_start",
          index: ev.blockIndex,
          content_block: { type: "text", text: "" },
        });
        return;
      case "text_delta":
        await ctx.writer.event("content_block_delta", {
          type: "content_block_delta",
          index: ev.blockIndex,
          delta: { type: "text_delta", text: ev.text },
        });
        return;
      case "text_end":
        await ctx.writer.event("content_block_stop", { type: "content_block_stop", index: ev.blockIndex });
        return;
      case "thinking_start":
        await ctx.writer.event("content_block_start", {
          type: "content_block_start",
          index: ev.blockIndex,
          content_block: { type: "thinking", thinking: "" },
        });
        return;
      case "thinking_delta":
        await ctx.writer.event("content_block_delta", {
          type: "content_block_delta",
          index: ev.blockIndex,
          delta: { type: "thinking_delta", thinking: ev.text },
        });
        return;
      case "thinking_end":
        await ctx.writer.event("content_block_stop", { type: "content_block_stop", index: ev.blockIndex });
        return;
      case "tool_call_start":
        await ctx.writer.event("content_block_start", {
          type: "content_block_start",
          index: ev.blockIndex,
          content_block: {
            type: "tool_use",
            id: ev.itemId,
            name: ev.name ?? "",
            input: {},
          },
        });
        return;
      case "tool_call_delta":
        await ctx.writer.event("content_block_delta", {
          type: "content_block_delta",
          index: ev.blockIndex,
          delta: { type: "input_json_delta", partial_json: ev.argumentsDelta },
        });
        return;
      case "tool_call_end":
        await ctx.writer.event("content_block_delta", {
          type: "content_block_delta",
          index: ev.blockIndex,
          delta: { type: "input_json_delta", partial_json: jsonDelta(ev.payload) },
        });
        await ctx.writer.event("content_block_stop", { type: "content_block_stop", index: ev.blockIndex });
        return;
      case "stop":
        await ctx.writer.event("message_delta", {
          type: "message_delta",
          delta: { stop_reason: ev.reason, stop_sequence: ev.stopSequence ?? null },
          usage: { output_tokens: ev.outputTokens },
        });
        await ctx.writer.event("message_stop", { type: "message_stop" });
        return;
      case "error":
        await ctx.writer.event("error", {
          type: "error",
          error: { type: ev.code, message: ev.message },
        });
        return;
      case "reasoning_item":
        return;
    }
  }

  async heartbeat(ctx: StreamCtx): Promise<void> {
    await ctx.writer.comment("ping");
    await ctx.writer.event("ping", { type: "ping" });
  }

  async closeStream(ctx: StreamCtx): Promise<void> {
    await ctx.writer.drain();
  }

  toJson(output: AssistantOutput, req: NormalizedRequest): unknown {
    const content = output.blocks.map(blockToAnthropic).filter((b) => b !== null);
    return {
      id: output.vendorMessageId,
      type: "message",
      role: "assistant",
      model: req.model,
      content,
      stop_reason: output.stopReason,
      stop_sequence: output.stopSequence ?? null,
      usage: usageZero(output.inputTokens, output.outputTokens),
    };
  }
}
