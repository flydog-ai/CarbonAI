import type { AssistantBlock, InternalEvent, StopReason } from "./events.ts";
import { estimateTextTokens } from "./tokens.ts";

export function eventsFromBlocks(opts: {
  jobId: string;
  vendorMessageId: string;
  model: string;
  createdAt: number;
  inputTokens: number;
  blocks: AssistantBlock[];
  stopReason?: StopReason;
  stopSequence?: string | null;
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

  opts.blocks.forEach((block, blockIndex) => {
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
