import type {
  ApplyPatchOp,
  AssistantBlock,
  AssistantOutput,
  InternalEvent,
  LocalShellAction,
  NormalizedRequest,
  ProtocolAdapter,
  ShellAction,
  StreamCtx,
  ToolKind,
  ToolPayload,
} from "../events.ts";
import { customToolInput, functionCallArguments, schemaForTool } from "../apply-patch.ts";
import { ids } from "../ids.ts";
import { asRecord } from "../record.ts";

export type OpenAIResponsesAdapterOpts = {
  heartbeat?: "both" | "keepalive" | "comment";
};

export type YouResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "in_progress" | "completed" | "failed" | "incomplete";
  error: { code: string; message: string } | null;
  incomplete_details: { reason: string } | null;
  instructions: string | null;
  max_output_tokens: number | null;
  model: string;
  output: unknown[];
  parallel_tool_calls: boolean;
  previous_response_id: string | null;
  reasoning: unknown | null;
  store: boolean;
  temperature: number | null;
  tool_choice: unknown | null;
  tools: unknown[];
  top_p: number | null;
  truncation: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens_details: { reasoning_tokens: number };
  } | null;
  user: string | null;
  metadata: Record<string, unknown>;
  text: unknown | null;
  service_tier: string | null;
};

function createdSec(ctx: StreamCtx): number {
  return Math.floor((ctx.createdAt ?? Date.now()) / 1000);
}

function responsesUsage(inputTokens: number, outputTokens: number): NonNullable<YouResponse["usage"]> {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

export function buildYouResponse(opts: {
  id: string;
  createdAtSec: number;
  status: YouResponse["status"];
  req: NormalizedRequest;
  output: unknown[];
  usage: YouResponse["usage"];
  error?: { code: string; message: string } | null;
  incomplete?: { reason: string } | null;
}): YouResponse {
  const extras = opts.req.extras;
  return {
    id: opts.id,
    object: "response",
    created_at: opts.createdAtSec,
    status: opts.status,
    error: opts.error ?? null,
    incomplete_details: opts.incomplete ?? null,
    instructions: typeof extras.instructions === "string" || extras.instructions === null ? (extras.instructions as string | null) : null,
    max_output_tokens: opts.req.maxTokens ?? null,
    model: opts.req.model,
    output: opts.output,
    parallel_tool_calls: extras.parallelToolCalls !== false,
    previous_response_id: opts.req.previousResponseId ?? null,
    reasoning: opts.req.reasoning ?? null,
    store: extras.store !== false,
    temperature: typeof extras.temperature === "number" ? extras.temperature : null,
    tool_choice: opts.req.toolChoice ?? null,
    tools: Array.isArray(extras.toolsRaw) ? extras.toolsRaw : [],
    top_p: typeof extras.topP === "number" ? extras.topP : null,
    truncation: typeof extras.truncation === "string" ? extras.truncation : null,
    usage: opts.usage,
    user: typeof extras.user === "string" ? extras.user : null,
    metadata: opts.req.metadata ?? {},
    text: extras.text ?? null,
    service_tier: typeof extras.serviceTier === "string" ? extras.serviceTier : null,
  };
}

function applyPatchOperation(payload: ToolPayload): ApplyPatchOp {
  if (payload.form === "apply_patch") return payload.operation;
  const rec = payload.form === "json" ? asRecord(payload.value) : undefined;
  const op = rec ? (asRecord(rec.operation) ?? rec) : undefined;
  if (op && typeof op.path === "string") {
    const type = op.type === "create_file" || op.type === "delete_file" ? op.type : "update_file";
    if (type === "delete_file") return { type, path: op.path };
    return { type, path: op.path, diff: typeof op.diff === "string" ? op.diff : "" };
  }
  return { type: "update_file", path: "", diff: "" };
}

function localShellAction(payload: ToolPayload): LocalShellAction {
  if (payload.form === "local_shell") {
    return {
      type: "exec",
      command: payload.action.command,
      env: payload.action.env ?? {},
      timeout_ms: payload.action.timeout_ms,
      user: payload.action.user,
      working_directory: payload.action.working_directory,
    };
  }
  const rec = payload.form === "json" ? asRecord(payload.value) : undefined;
  const command = Array.isArray(rec?.command)
    ? rec!.command.map((c) => String(c))
    : typeof rec?.command === "string"
      ? [rec.command]
      : ["ls"];
  const envRec = asRecord(rec?.env) ?? {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envRec)) env[k] = String(v);
  const action: LocalShellAction = { type: "exec", command, env };
  if (typeof rec?.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec?.user === "string") action.user = rec.user;
  if (typeof rec?.working_directory === "string") action.working_directory = rec.working_directory;
  return action;
}

function shellAction(payload: ToolPayload): ShellAction {
  if (payload.form === "shell") return payload.action;
  const rec = payload.form === "json" ? asRecord(payload.value) : undefined;
  const commands = Array.isArray(rec?.commands)
    ? rec!.commands.map((c) => String(c))
    : typeof rec?.commands === "string"
      ? [rec.commands]
      : ["ls"];
  const action: ShellAction = { commands };
  if (typeof rec?.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec?.max_output_length === "number") action.max_output_length = rec.max_output_length;
  return action;
}

function outputTextPart(text: string): Record<string, unknown> {
  return { type: "output_text", text, annotations: [] };
}

function messageItem(id: string, status: "in_progress" | "completed", text: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    status,
    role: "assistant",
    content: status === "in_progress" ? [] : [outputTextPart(text)],
  };
}

function reasoningItem(id: string, summary: { type: "summary_text"; text: string }[], encrypted?: string): Record<string, unknown> {
  const item: Record<string, unknown> = { id, type: "reasoning", summary };
  if (encrypted) item.encrypted_content = encrypted;
  return item;
}

function functionCallItem(
  id: string,
  callId: string,
  name: string,
  args: string,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  return { id, type: "function_call", status, call_id: callId, name, arguments: args };
}

function customToolItem(
  id: string,
  callId: string,
  name: string,
  input: string,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  return { id, type: "custom_tool_call", status, call_id: callId, name, input };
}

function applyPatchItem(
  id: string,
  callId: string,
  operation: ApplyPatchOp,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  return { id, type: "apply_patch_call", status, call_id: callId, operation };
}

function localShellItem(
  id: string,
  callId: string,
  action: LocalShellAction,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  return { id, type: "local_shell_call", status, call_id: callId, action };
}

function shellItem(
  id: string,
  callId: string,
  action: ShellAction,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  return { id, type: "shell_call", status, call_id: callId, action };
}

function toolItemFromBlock(block: Extract<AssistantBlock, { type: "tool_use" }>, req: NormalizedRequest): Record<string, unknown> {
  const id = block.id || block.callId;
  const callId = block.callId || block.id;
  const name = block.name ?? "";
  switch (block.kind) {
    case "openai_custom":
      return customToolItem(id, callId, name, customToolInput(block.payload), "completed");
    case "apply_patch":
      return applyPatchItem(id, callId, applyPatchOperation(block.payload), "completed");
    case "local_shell":
      return localShellItem(id, callId, localShellAction(block.payload), "completed");
    case "shell":
      return shellItem(id, callId, shellAction(block.payload), "completed");
    default:
      return functionCallItem(
        id,
        callId,
        name,
        functionCallArguments(name, block.payload, schemaForTool(req, name)),
        "completed",
      );
  }
}

export function outputItemsFromBlocks(blocks: AssistantBlock[], req: NormalizedRequest): unknown[] {
  const items: unknown[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "reasoning":
        items.push(reasoningItem(block.id, block.summary, block.encryptedContent));
        break;
      case "text":
        items.push(messageItem(ids.msg(), "completed", block.text));
        break;
      case "tool_use":
        items.push(toolItemFromBlock(block, req));
        break;
      default:
        break;
    }
  }
  return items;
}

type ItemState = {
  outputIndex: number;
  itemId: string;
  kind: ToolKind | "message" | "reasoning";
  callId: string;
  name?: string;
  text: string;
  args: string;
};

export class OpenAIResponsesAdapter implements ProtocolAdapter {
  protocol = "openai_responses" as const;
  private started = false;
  private seq = 0;
  private createdAtSec = 0;
  private outputIndex = 0;
  private items = new Map<number, ItemState>();
  private output: unknown[] = [];
  private failed: { code: string; message: string } | null = null;

  constructor(private readonly opts: OpenAIResponsesAdapterOpts = {}) {}

  private nextSeq(): number {
    const n = this.seq;
    this.seq += 1;
    return n;
  }

  private async emit(ctx: StreamCtx, type: string, rest: Record<string, unknown>): Promise<void> {
    await ctx.writer.event(type, { type, sequence_number: this.nextSeq(), ...rest });
  }

  private snapshot(ctx: StreamCtx, status: YouResponse["status"], output: unknown[], usage: YouResponse["usage"]): YouResponse {
    return buildYouResponse({
      id: ctx.vendorMessageId,
      createdAtSec: this.createdAtSec || createdSec(ctx),
      status,
      req: ctx.request,
      output,
      usage,
      error: this.failed,
    });
  }

  async openStream(ctx: StreamCtx): Promise<void> {
    this.createdAtSec = createdSec(ctx);
    const snap = this.snapshot(ctx, "in_progress", [], null);
    await this.emit(ctx, "response.created", { response: snap });
    await this.emit(ctx, "response.in_progress", { response: snap });
    this.started = true;
  }

  async apply(ctx: StreamCtx, ev: InternalEvent): Promise<void> {
    switch (ev.type) {
      case "job_start":
        if (!this.started) await this.openStream(ctx);
        return;
      case "reasoning_item": {
        const outputIndex = this.outputIndex++;
        const item = reasoningItem(ev.id, ev.summary, ev.encryptedContent);
        this.items.set(ev.blockIndex, {
          outputIndex,
          itemId: ev.id,
          kind: "reasoning",
          callId: ev.id,
          text: "",
          args: "",
        });
        await this.emit(ctx, "response.output_item.added", { output_index: outputIndex, item });
        await this.emit(ctx, "response.output_item.done", { output_index: outputIndex, item });
        this.output.push(item);
        return;
      }
      case "text_start": {
        const outputIndex = this.outputIndex++;
        const itemId = ids.msg();
        this.items.set(ev.blockIndex, {
          outputIndex,
          itemId,
          kind: "message",
          callId: itemId,
          text: "",
          args: "",
        });
        await this.emit(ctx, "response.output_item.added", {
          output_index: outputIndex,
          item: messageItem(itemId, "in_progress", ""),
        });
        await this.emit(ctx, "response.content_part.added", {
          output_index: outputIndex,
          content_index: 0,
          item_id: itemId,
          part: outputTextPart(""),
        });
        return;
      }
      case "text_delta": {
        const st = this.items.get(ev.blockIndex);
        if (!st) return;
        st.text += ev.text;
        await this.emit(ctx, "response.output_text.delta", {
          output_index: st.outputIndex,
          content_index: 0,
          item_id: st.itemId,
          delta: ev.text,
        });
        return;
      }
      case "text_end": {
        const st = this.items.get(ev.blockIndex);
        if (!st) return;
        const item = messageItem(st.itemId, "completed", st.text);
        await this.emit(ctx, "response.output_text.done", {
          output_index: st.outputIndex,
          content_index: 0,
          item_id: st.itemId,
          text: st.text,
        });
        await this.emit(ctx, "response.content_part.done", {
          output_index: st.outputIndex,
          content_index: 0,
          item_id: st.itemId,
          part: outputTextPart(st.text),
        });
        await this.emit(ctx, "response.output_item.done", { output_index: st.outputIndex, item });
        this.output.push(item);
        return;
      }
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
        return;
      case "tool_call_start": {
        const outputIndex = this.outputIndex++;
        const itemId = ev.itemId || ids.fc();
        const callId = ev.callId || ids.call();
        this.items.set(ev.blockIndex, {
          outputIndex,
          itemId,
          kind: ev.kind,
          callId,
          name: ev.name,
          text: "",
          args: "",
        });
        const item = this.startItem(ev.kind, itemId, callId, ev.name ?? "");
        await this.emit(ctx, "response.output_item.added", { output_index: outputIndex, item });
        return;
      }
      case "tool_call_delta": {
        const st = this.items.get(ev.blockIndex);
        if (!st) return;
        if (st.kind !== "openai_function" && st.kind !== "openai_custom" && st.kind !== "anthropic_tool_use") return;
        st.args += ev.argumentsDelta;
        const type =
          st.kind === "openai_custom"
            ? "response.custom_tool_call_input.delta"
            : "response.function_call_arguments.delta";
        await this.emit(ctx, type, {
          output_index: st.outputIndex,
          item_id: st.itemId,
          delta: ev.argumentsDelta,
        });
        return;
      }
      case "tool_call_end": {
        const st = this.items.get(ev.blockIndex);
        if (!st) return;
        await this.finishTool(ctx, st, ev.payload, ctx.request);
        return;
      }
      case "stop": {
        const snap = this.snapshot(
          ctx,
          "completed",
          this.output,
          responsesUsage(ev.inputTokens, ev.outputTokens),
        );
        await this.emit(ctx, "response.completed", { response: snap });
        await ctx.writer.data("[DONE]");
        return;
      }
      case "error": {
        this.failed = { code: ev.code === "timeout" ? "server_error" : ev.code, message: ev.message };
        const snap = this.snapshot(ctx, "failed", this.output, null);
        await this.emit(ctx, "response.failed", { response: snap });
        await ctx.writer.data("[DONE]");
        return;
      }
    }
  }

  private startItem(kind: ToolKind, id: string, callId: string, name: string): Record<string, unknown> {
    switch (kind) {
      case "openai_custom":
        return customToolItem(id, callId, name, "", "in_progress");
      case "apply_patch":
        return applyPatchItem(id, callId, { type: "update_file", path: "", diff: "" }, "in_progress");
      case "local_shell":
        return localShellItem(id, callId, { type: "exec", command: [], env: {} }, "in_progress");
      case "shell":
        return shellItem(id, callId, { commands: [] }, "in_progress");
      default:
        return functionCallItem(id, callId, name, "", "in_progress");
    }
  }

  private async finishTool(
    ctx: StreamCtx,
    st: ItemState,
    payload: ToolPayload,
    req: NormalizedRequest,
  ): Promise<void> {
    const name = st.name ?? "";
    let item: Record<string, unknown>;
    switch (st.kind) {
      case "openai_custom": {
        const input = customToolInput(payload);
        if (!st.args) {
          await this.emit(ctx, "response.custom_tool_call_input.delta", {
            output_index: st.outputIndex,
            item_id: st.itemId,
            delta: input,
          });
        }
        await this.emit(ctx, "response.custom_tool_call_input.done", {
          output_index: st.outputIndex,
          item_id: st.itemId,
          input,
        });
        item = customToolItem(st.itemId, st.callId, name, input, "completed");
        break;
      }
      case "apply_patch":
        item = applyPatchItem(st.itemId, st.callId, applyPatchOperation(payload), "completed");
        break;
      case "local_shell":
        item = localShellItem(st.itemId, st.callId, localShellAction(payload), "completed");
        break;
      case "shell":
        item = shellItem(st.itemId, st.callId, shellAction(payload), "completed");
        break;
      default: {
        const args = functionCallArguments(name, payload, schemaForTool(req, name));
        if (!st.args) {
          await this.emit(ctx, "response.function_call_arguments.delta", {
            output_index: st.outputIndex,
            item_id: st.itemId,
            delta: args,
          });
        }
        await this.emit(ctx, "response.function_call_arguments.done", {
          output_index: st.outputIndex,
          item_id: st.itemId,
          arguments: args,
        });
        item = functionCallItem(st.itemId, st.callId, name, args, "completed");
        break;
      }
    }
    await this.emit(ctx, "response.output_item.done", { output_index: st.outputIndex, item });
    this.output.push(item);
  }

  async heartbeat(ctx: StreamCtx): Promise<void> {
    const mode = this.opts.heartbeat ?? "both";
    if (mode === "comment" || mode === "both") {
      await ctx.writer.comment("ping");
    }
    if (mode === "keepalive" || mode === "both") {
      await this.emit(ctx, "keepalive", {});
    }
  }

  async closeStream(ctx: StreamCtx): Promise<void> {
    await ctx.writer.drain();
  }

  toJson(output: AssistantOutput, req: NormalizedRequest): unknown {
    const items = outputItemsFromBlocks(output.blocks, req);
    if (this.failed) {
      return buildYouResponse({
        id: output.vendorMessageId,
        createdAtSec: Math.floor(output.createdAt / 1000),
        status: "failed",
        req,
        output: items,
        usage: null,
        error: this.failed,
      });
    }
    return buildYouResponse({
      id: output.vendorMessageId,
      createdAtSec: Math.floor(output.createdAt / 1000),
      status: "completed",
      req,
      output: items,
      usage: responsesUsage(output.inputTokens, output.outputTokens),
    });
  }
}
