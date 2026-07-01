import type { AssistantBlock, AssistantOutput, InternalEvent, StopReason, ToolKind, ToolPayload } from "./events.ts";

export function fold(events: InternalEvent[]): AssistantOutput {
  let vendorMessageId = "";
  let model = "";
  let createdAt = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = "end_turn";
  let stopSequence: string | null | undefined;
  const blocks: AssistantBlock[] = [];

  let text = "";
  let thinking = "";
  let thinkingSig: string | undefined;
  let tool: {
    kind: ToolKind;
    id: string;
    callId: string;
    name?: string;
    payload?: ToolPayload;
  } | null = null;

  const flushText = (): void => {
    if (text.length > 0) {
      blocks.push({ type: "text", text });
      text = "";
    }
  };
  const flushThinking = (): void => {
    if (thinking.length > 0) {
      blocks.push({ type: "thinking", thinking, signature: thinkingSig });
      thinking = "";
      thinkingSig = undefined;
    }
  };
  const flushTool = (): void => {
    if (tool && tool.payload) {
      blocks.push({
        type: "tool_use",
        kind: tool.kind,
        id: tool.id,
        callId: tool.callId,
        name: tool.name,
        payload: tool.payload,
      });
    }
    tool = null;
  };

  for (const ev of events) {
    switch (ev.type) {
      case "job_start":
        vendorMessageId = ev.vendorMessageId;
        model = ev.model;
        createdAt = ev.createdAt;
        inputTokens = ev.inputTokens;
        break;
      case "text_start":
        flushThinking();
        flushTool();
        text = "";
        break;
      case "text_delta":
        text += ev.text;
        break;
      case "text_end":
        flushText();
        break;
      case "thinking_start":
        flushText();
        thinking = "";
        break;
      case "thinking_delta":
        thinking += ev.text;
        break;
      case "thinking_end":
        thinkingSig = ev.signature;
        flushThinking();
        break;
      case "reasoning_item":
        flushText();
        flushThinking();
        blocks.push({
          type: "reasoning",
          id: ev.id,
          summary: ev.summary,
          encryptedContent: ev.encryptedContent,
        });
        break;
      case "tool_call_start":
        flushText();
        flushThinking();
        tool = {
          kind: ev.kind,
          id: ev.itemId,
          callId: ev.callId,
          name: ev.name,
        };
        break;
      case "tool_call_delta":
        break;
      case "tool_call_end":
        if (tool) tool.payload = ev.payload;
        flushTool();
        break;
      case "stop":
        flushText();
        flushThinking();
        flushTool();
        stopReason = ev.reason;
        stopSequence = ev.stopSequence;
        outputTokens = ev.outputTokens;
        inputTokens = ev.inputTokens;
        break;
      case "error":
        break;
    }
  }
  flushText();
  flushThinking();
  flushTool();

  return {
    vendorMessageId,
    model,
    createdAt,
    blocks,
    stopReason,
    stopSequence,
    inputTokens,
    outputTokens,
  };
}
