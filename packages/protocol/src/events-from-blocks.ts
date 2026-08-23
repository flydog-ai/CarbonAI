import type { AssistantBlock, InternalEvent, NormalizedRequest, StopReason } from "./events.ts";
import { opaqueEncryptedContent } from "./encrypted.ts";
import { ids } from "./ids.ts";
import { estimateTextTokens } from "./tokens.ts";

function shouldEmitEmptyReasoning(
  req: NormalizedRequest | undefined,
  mode: "auto" | "always" | "never" | undefined,
): boolean {
  if (!req) return false;
  if (mode === "never") return false;
  if (mode === "always") return true;
  const include = req.include ?? [];
  const hasInclude = include.includes("reasoning.encrypted_content");
  const hasKey = req.reasoning != null || req.extras.hasReasoningKey === true;
  return hasKey || hasInclude;
}

export function eventsFromBlocks(opts: {
  jobId: string;
  vendorMessageId: string;
  model: string;
  createdAt: number;
  inputTokens: number;
  blocks: AssistantBlock[];
  stopReason?: StopReason;
  stopSequence?: string | null;
  request?: NormalizedRequest;
  emitEmptyReasoning?: "auto" | "always" | "never";
}): InternalEvent[] {
  const events: InternalEvent[] = [
    {
      type: "job_start",
      jobId: opts.jobId,
      vendorMessageId: opts.vendorMessageId,
      model: opts.model,
      createdAt: opts.createdAt,
      inputTokens: opts.inputTokens,
    },
  ];

  let outputTokens = 0;
  let hasTool = false;
  const blocks = [...opts.blocks];
  if (
    shouldEmitEmptyReasoning(opts.request, opts.emitEmptyReasoning) &&
    !blocks.some((b) => b.type === "reasoning")
  ) {
    const includeEnc = opts.request?.include?.includes("reasoning.encrypted_content") === true;
    blocks.unshift({
      type: "reasoning",
      id: ids.rs(),
      summary: [],
      encryptedContent: includeEnc ? opaqueEncryptedContent(opts.vendorMessageId) : undefined,
    });
  }

  blocks.forEach((block, blockIndex) => {
    switch (block.type) {
      case "text":
        outputTokens += estimateTextTokens(block.text);
        events.push({ type: "text_start", blockIndex });
        if (block.text.length > 0) {
          events.push({ type: "text_delta", blockIndex, text: block.text });
        }
        events.push({ type: "text_end", blockIndex });
        break;
      case "thinking":
        outputTokens += estimateTextTokens(block.thinking);
        events.push({ type: "thinking_start", blockIndex });
        if (block.thinking.length > 0) {
          events.push({ type: "thinking_delta", blockIndex, text: block.thinking });
        }
        events.push({ type: "thinking_end", blockIndex, signature: block.signature });
        break;
      case "reasoning":
        events.push({
          type: "reasoning_item",
          blockIndex,
          id: block.id,
          summary: block.summary,
          encryptedContent: block.encryptedContent,
        });
        break;
      case "tool_use":
        hasTool = true;
        events.push({
          type: "tool_call_start",
          blockIndex,
          kind: block.kind,
          itemId: block.id,
          callId: block.callId,
          name: block.name,
        });
        events.push({ type: "tool_call_end", blockIndex, payload: block.payload });
        break;
    }
  });

  const reason: StopReason = opts.stopReason ?? (hasTool ? "tool_use" : "end_turn");
  events.push({
    type: "stop",
    reason,
    stopSequence: opts.stopSequence ?? null,
    outputTokens,
    inputTokens: opts.inputTokens,
  });
  return events;
}
