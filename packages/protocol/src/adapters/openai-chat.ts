import type {
  AssistantBlock,
  AssistantOutput,
  InternalEvent,
  NormalizedRequest,
  ProtocolAdapter,
  StopReason,
  StreamCtx,
} from "../events.ts";
import { functionCallArguments, schemaForTool } from "../apply-patch.ts";

export type OpenAIChatAdapterOpts = {
  heartbeat?: "comment" | "empty_delta";
  midstreamError?: "error_chunk" | "silent_close";
};

function createdSec(ctx: StreamCtx): number {
  return Math.floor((ctx.createdAt ?? Date.now()) / 1000);
}

function finishReason(reason: StopReason): string {
  switch (reason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

function usage(inputTokens: number, outputTokens: number): Record<string, number> {
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

export class OpenAIChatAdapter implements ProtocolAdapter {
  protocol = "openai_chat" as const;
  private started = false;
  private toolIndex = new Map<number, number>();
  private toolNames = new Map<number, string | undefined>();
  private nextTool = 0;

  constructor(private readonly opts: OpenAIChatAdapterOpts = {}) {}

  private includeUsage(req: NormalizedRequest): boolean {
    return req.extras.includeUsage === true;
  }

  private async chunk(
    ctx: StreamCtx,
    delta: Record<string, unknown>,
    finish: string | null = null,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      id: ctx.vendorMessageId,
      object: "chat.completion.chunk",
      created: createdSec(ctx),
      model: ctx.request.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    if (this.includeUsage(ctx.request)) body.usage = null;
    await ctx.writer.data(JSON.stringify(body));
  }

  async openStream(ctx: StreamCtx): Promise<void> {
    await this.chunk(ctx, { role: "assistant" });
    this.started = true;
  }

  async apply(ctx: StreamCtx, ev: InternalEvent): Promise<void> {
    switch (ev.type) {
      case "job_start":
        if (!this.started) await this.openStream(ctx);
        return;
      case "text_start":
        return;
      case "text_delta":
        await this.chunk(ctx, { content: ev.text });
        return;
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "reasoning_item":
        return;
      case "tool_call_start": {
        const index = this.nextTool++;
        this.toolIndex.set(ev.blockIndex, index);
        this.toolNames.set(ev.blockIndex, ev.name);
        await this.chunk(ctx, {
          tool_calls: [
            {
              index,
              id: ev.callId || ev.itemId,
              type: "function",
              function: { name: ev.name ?? "", arguments: "" },
            },
          ],
        });
        return;
      }
      case "tool_call_delta": {
        const index = this.toolIndex.get(ev.blockIndex) ?? 0;
        await this.chunk(ctx, {
          tool_calls: [{ index, function: { arguments: ev.argumentsDelta } }],
        });
        return;
      }
      case "tool_call_end": {
        const index = this.toolIndex.get(ev.blockIndex) ?? 0;
        const name = this.toolNames.get(ev.blockIndex);
        const args = functionCallArguments(name, ev.payload, schemaForTool(ctx.request, name));
        await this.chunk(ctx, {
          tool_calls: [{ index, function: { arguments: args } }],
        });
        return;
      }
      case "stop": {
        await this.chunk(ctx, {}, finishReason(ev.reason));
        if (this.includeUsage(ctx.request)) {
          await ctx.writer.data(
            JSON.stringify({
              id: ctx.vendorMessageId,
              object: "chat.completion.chunk",
              created: createdSec(ctx),
              model: ctx.request.model,
              choices: [],
              usage: usage(ev.inputTokens, ev.outputTokens),
            }),
          );
        }
        await ctx.writer.data("[DONE]");
        return;
      }
      case "error": {
        if ((this.opts.midstreamError ?? "error_chunk") === "silent_close") return;
        const code = ev.code === "timeout" ? "timeout" : ev.code;
        await ctx.writer.data(
          JSON.stringify({
            error: {
              message: ev.message,
              type: "server_error",
              param: null,
              code,
            },
          }),
        );
        return;
      }
    }
  }

  async heartbeat(ctx: StreamCtx): Promise<void> {
    if ((this.opts.heartbeat ?? "comment") === "empty_delta") {
      await this.chunk(ctx, {});
      return;
    }
    await ctx.writer.comment("ping");
  }

  async closeStream(ctx: StreamCtx): Promise<void> {
    await ctx.writer.drain();
  }

  toJson(output: AssistantOutput, req: NormalizedRequest): unknown {
    const texts = output.blocks.filter((b): b is Extract<AssistantBlock, { type: "text" }> => b.type === "text");
    const tools = output.blocks.filter((b): b is Extract<AssistantBlock, { type: "tool_use" }> => b.type === "tool_use");
    const text = texts.map((t) => t.text).join("");
    const content = texts.length > 0 ? text : tools.length > 0 ? null : "";
    const message: Record<string, unknown> = {
      role: "assistant",
      content,
      refusal: null,
    };
    if (tools.length > 0) {
      message.tool_calls = tools.map((t) => ({
        id: t.callId || t.id,
        type: "function",
        function: {
          name: t.name ?? "",
          arguments: functionCallArguments(t.name, t.payload, schemaForTool(req, t.name)),
        },
      }));
    }
    return {
      id: output.vendorMessageId,
      object: "chat.completion",
      created: Math.floor(output.createdAt / 1000),
      model: req.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason(output.stopReason),
          logprobs: null,
        },
      ],
      usage: usage(output.inputTokens, output.outputTokens),
      system_fingerprint: null,
    };
  }
}
