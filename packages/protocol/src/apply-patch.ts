import type { NormalizedRequest, ToolPayload } from "./events.ts";
import { asRecord } from "./record.ts";

/** Pick the string field Codex-style function apply_patch wraps Begin Patch into. */
export function pickRequiredStringKey(schema: unknown): string | undefined {
  const rec = asRecord(schema);
  if (!rec) return undefined;
  if (Array.isArray(rec.required) && typeof rec.required[0] === "string") return rec.required[0];
  const props = asRecord(rec.properties);
  if (!props) return undefined;
  const stringKeys = Object.keys(props).filter((k) => {
    const p = asRecord(props[k]);
    return p?.type === "string";
  });
  return stringKeys.length === 1 ? stringKeys[0] : undefined;
}

export function wrapFunctionApplyPatchArgs(schema: unknown, beginPatch: string): string {
  const key = pickRequiredStringKey(schema) ?? "input";
  return JSON.stringify({ [key]: beginPatch });
}

export function schemaForTool(req: NormalizedRequest, name?: string): unknown {
  if (!name) return undefined;
  const tool = req.tools.find((t) => "name" in t && t.name === name);
  return tool && "inputSchema" in tool ? tool.inputSchema : undefined;
}

export function beginPatchText(payload: ToolPayload): string {
  if (payload.form === "freeform") return payload.value;
  if (payload.form === "json") {
    if (typeof payload.value === "string") return payload.value;
    const rec = asRecord(payload.value);
    if (rec && typeof rec.input === "string") return rec.input;
  }
  if (payload.form === "apply_patch") {
    const op = payload.operation;
    if (op.type === "delete_file") {
      return `*** Begin Patch\n*** Delete File: ${op.path}\n*** End Patch\n`;
    }
    const header = op.type === "create_file" ? "*** Add File:" : "*** Update File:";
    return `*** Begin Patch\n${header} ${op.path}\n${op.diff}\n*** End Patch\n`;
  }
  return "";
}

export function jsonToolArguments(payload: ToolPayload): string {
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

/** `arguments` for Chat tool_calls / Responses function_call. Never emit raw Begin Patch for name=apply_patch. */
export function functionCallArguments(name: string | undefined, payload: ToolPayload, schema: unknown): string {
  if (name === "apply_patch") {
    return wrapFunctionApplyPatchArgs(schema, beginPatchText(payload));
  }
  return jsonToolArguments(payload);
}

export function customToolInput(payload: ToolPayload): string {
  if (payload.form === "freeform") return payload.value;
  if (payload.form === "json") {
    if (typeof payload.value === "string") return payload.value;
    const rec = asRecord(payload.value);
    if (rec && typeof rec.input === "string") return rec.input;
    return JSON.stringify(payload.value ?? "");
  }
  return beginPatchText(payload);
}
