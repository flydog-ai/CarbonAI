export type Protocol = "anthropic_messages" | "openai_chat" | "openai_responses";

export type ToolKind =
  | "anthropic_tool_use"
  | "openai_function"
  | "openai_custom"
  | "apply_patch"
  | "local_shell"
  | "shell";

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      mediaType: string;
      source: "base64" | "url";
      byteLength: number;
      sha256?: string;
      url?: string;
    }
  | {
      type: "document";
      title?: string;
      mediaType: string;
      byteLength: number;
      sha256?: string;
      excerpt?: string;
    }
  | {
      type: "tool_use";
      kind: ToolKind;
      id: string;
      callId: string;
      name?: string;
      payload: ToolPayload;
    }
  | {
      type: "tool_result";
      kind: ToolKind | "unknown";
      toolUseId: string;
      callId?: string;
      isError?: boolean;
      content: ContentPart[];
      vendorRaw?: unknown;
    }
  | {
      type: "reasoning";
      id: string;
      summary: { type: "summary_text"; text: string }[];
      encryptedContent?: string;
    }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "unknown"; vendorType: string; raw: unknown };

export type ApplyPatchOp =
  | { type: "create_file"; path: string; diff: string }
  | { type: "update_file"; path: string; diff: string }
  | { type: "delete_file"; path: string };

export type LocalShellAction = {
  type: "exec";
  command: string[];
  env: Record<string, string>;
  timeout_ms?: number;
  user?: string;
  working_directory?: string;
};

export type ShellAction = {
  commands: string[];
  timeout_ms?: number;
  max_output_length?: number;
};

export type ToolPayload =
  | { form: "json"; value: unknown }
  | { form: "freeform"; value: string }
  | { form: "apply_patch"; operation: ApplyPatchOp }
  | { form: "local_shell"; action: LocalShellAction }
  | { form: "shell"; action: ShellAction };

export type NormalizedMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  parts: ContentPart[];
};

export type NormalizedTool =
  | {
      kind: "anthropic_tool_use" | "openai_function" | "openai_custom";
      name: string;
      description?: string;
      inputSchema?: unknown;
      vendorRaw: unknown;
    }
  | {
      kind: "apply_patch" | "local_shell" | "shell";
      description?: string;
      vendorRaw: unknown;
    };

export type NormalizedRequest = {
  protocol: Protocol;
  model: string;
  displayModel: string;
  system: ContentPart[];
  messages: NormalizedMessage[];
  tools: NormalizedTool[];
  toolChoice: unknown | null;
  maxTokens?: number;
  stream: boolean;
  stopSequences: string[];
  metadata: Record<string, unknown>;
  extras: Record<string, unknown>;
  previousResponseId?: string;
  store?: boolean;
  include?: string[];
  reasoning?: unknown;
  thinking?: unknown;
};

export type StopReason = "end_turn" | "max_tokens" | "tool_use" | "stop_sequence";

export type InternalEvent =
  | {
      type: "job_start";
      jobId: string;
      vendorMessageId: string;
      model: string;
      createdAt: number;
      inputTokens: number;
    }
  | { type: "text_start"; blockIndex: number }
  | { type: "text_delta"; blockIndex: number; text: string }
  | { type: "text_end"; blockIndex: number }
  | { type: "thinking_start"; blockIndex: number }
  | { type: "thinking_delta"; blockIndex: number; text: string }
  | { type: "thinking_end"; blockIndex: number; signature?: string }
  | {
      type: "reasoning_item";
      blockIndex: number;
      id: string;
      summary: { type: "summary_text"; text: string }[];
      encryptedContent?: string;
    }
  | {
      type: "tool_call_start";
      blockIndex: number;
      kind: ToolKind;
      itemId: string;
      callId: string;
      name?: string;
    }
  | { type: "tool_call_delta"; blockIndex: number; argumentsDelta: string }
  | { type: "tool_call_end"; blockIndex: number; payload: ToolPayload }
  | {
      type: "stop";
      reason: StopReason;
      stopSequence?: string | null;
      outputTokens: number;
      inputTokens: number;
    }
  | { type: "error"; code: string; message: string };

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | {
      type: "reasoning";
      id: string;
      summary: { type: "summary_text"; text: string }[];
      encryptedContent?: string;
    }
  | {
      type: "tool_use";
      kind: ToolKind;
      id: string;
      callId: string;
      name?: string;
      payload: ToolPayload;
    };

export type AssistantOutput = {
  vendorMessageId: string;
  model: string;
  createdAt: number;
  blocks: AssistantBlock[];
  stopReason: StopReason;
  stopSequence?: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type JobStatus = "pending" | "claimed" | "streaming" | "completed" | "cancelled" | "failed";

export type CancelReason = "client_disconnect" | "operator" | "timeout" | "write_fail" | "gateway_restart";

export type SseSink = {
  comment(s: string): Promise<void>;
  data(payload: string): Promise<void>;
  event(name: string, payload: unknown): Promise<void>;
  drain(): Promise<void>;
};

export type StreamCtx = {
  jobId: string;
  writer: SseSink;
  request: NormalizedRequest;
  vendorMessageId: string;
};

export interface ProtocolAdapter {
  protocol: Protocol;
  openStream(ctx: StreamCtx): Promise<void>;
  apply(ctx: StreamCtx, ev: InternalEvent): Promise<void>;
  heartbeat(ctx: StreamCtx): Promise<void>;
  closeStream(ctx: StreamCtx): Promise<void>;
  toJson(output: AssistantOutput, req: NormalizedRequest): unknown;
}

export function emptyNormalizedRequest(over: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    protocol: "anthropic_messages",
    model: "carbon-default",
    displayModel: "Carbon AI",
    system: [],
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    tools: [],
    toolChoice: null,
    stream: true,
    stopSequences: [],
    metadata: {},
    extras: {},
    ...over,
  };
}
