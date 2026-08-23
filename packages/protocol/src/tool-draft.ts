import type {
  ApplyPatchOp,
  AssistantBlock,
  LocalShellAction,
  NormalizedTool,
  ShellAction,
  ToolKind,
  ToolPayload,
} from "./events.ts";
import { ids } from "./ids.ts";
import { asRecord } from "./record.ts";

export type ToolInputMode = "json" | "freeform" | "apply_patch" | "local_shell" | "shell";

export type ToolParam = {
  key: string;
  type: string;
  required: boolean;
  description?: string;
};

export type PublicTool = {
  key: string;
  kind: ToolKind;
  name: string;
  description?: string;
  required: string[];
  params: ToolParam[];
  inputMode: ToolInputMode;
  template: string;
};

export type OperatorToolDraft = {
  name?: string;
  kind?: ToolKind;
  input: unknown;
};

export class ToolDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDraftError";
  }
}

const TOOL_KINDS: ToolKind[] = [
  "anthropic_tool_use",
  "openai_function",
  "openai_custom",
  "apply_patch",
  "local_shell",
  "shell",
];

const CLAUDE_TEMPLATES: Record<string, unknown> = {
  Bash: { command: "", timeout: 120000 },
  Read: { file_path: "" },
  Edit: { file_path: "", old_string: "", new_string: "" },
  Write: { file_path: "", content: "" },
  Glob: { pattern: "" },
  Grep: { pattern: "", path: "" },
};

export const BEGIN_PATCH_TEMPLATE = `*** Begin Patch
*** Update File: path/to/file
@@
-old
+new
*** End Patch
`;

const APPLY_PATCH_TEMPLATE = {
  type: "update_file",
  path: "",
  diff: "@@\n-old\n+new",
};

const LOCAL_SHELL_TEMPLATE: LocalShellAction = { type: "exec", command: ["ls"], env: {} };
const SHELL_TEMPLATE: ShellAction = { commands: ["ls"], timeout_ms: 120000 };

export function isToolKind(value: unknown): value is ToolKind {
  return typeof value === "string" && (TOOL_KINDS as string[]).includes(value);
}

export function catalogName(tool: NormalizedTool): string {
  return "name" in tool ? tool.name : tool.kind;
}

export function schemaRequiredKeys(schema: unknown): string[] {
  const rec = asRecord(schema);
  if (!rec || !Array.isArray(rec.required)) return [];
  return rec.required.filter((k): k is string => typeof k === "string");
}

export function payloadPreview(payload: ToolPayload): string {
  switch (payload.form) {
    case "json":
      return typeof payload.value === "string" ? payload.value : pretty(payload.value ?? {});
    case "freeform":
      return payload.value;
    case "apply_patch":
      return pretty(payload.operation);
    case "local_shell":
      return pretty(payload.action);
    case "shell":
      return pretty(payload.action);
  }
}

export function inputModeFor(tool: NormalizedTool): ToolInputMode {
  if (tool.kind === "apply_patch") return "apply_patch";
  if (tool.kind === "local_shell") return "local_shell";
  if (tool.kind === "shell") return "shell";
  if (catalogName(tool) === "apply_patch") return "freeform";
  return "json";
}

export function templateFor(tool: NormalizedTool): string {
  const mode = inputModeFor(tool);
  if (mode === "freeform") return BEGIN_PATCH_TEMPLATE;
  if (mode === "apply_patch") return pretty(APPLY_PATCH_TEMPLATE);
  if (mode === "local_shell") return pretty(LOCAL_SHELL_TEMPLATE);
  if (mode === "shell") return pretty(SHELL_TEMPLATE);
  const schema = "inputSchema" in tool ? tool.inputSchema : undefined;
  const fromSchema = emptyFromSchema(schema);
  if (fromSchema && Object.keys(fromSchema).length > 0) return pretty(fromSchema);
  const named = CLAUDE_TEMPLATES[catalogName(tool)];
  if (named) return pretty(named);
  return pretty(fromSchema ?? {});
}

const DESC_MAX = 500;
const TEMPLATE_MAX = 8 * 1024;
const TEMPLATE_KEYS_MAX = 24;

export function publicTools(tools: NormalizedTool[]): PublicTool[] {
  return tools.map((tool, i) => {
    const name = catalogName(tool);
    const schema = "inputSchema" in tool ? tool.inputSchema : undefined;
    const description = tool.description
      ? tool.description.length > DESC_MAX
        ? tool.description.slice(0, DESC_MAX)
        : tool.description
      : undefined;
    let template = templateFor(tool);
    if (template.length > TEMPLATE_MAX) template = pretty({});
    return {
      key: `${i}:${tool.kind}:${name}`,
      kind: tool.kind,
      name,
      description,
      required: schemaRequiredKeys(schema),
      params: paramsFor(tool),
      inputMode: inputModeFor(tool),
      template,
    };
  });
}

export function findCatalogTool(catalog: NormalizedTool[], draft: OperatorToolDraft): NormalizedTool | undefined {
  const name = draft.name;
  const kind = draft.kind;
  if (name) {
    const named = catalog.filter((t) => "name" in t && t.name === name);
    if (kind) {
      const hit = named.find((t) => t.kind === kind);
      if (hit) return hit;
    }
    if (named.length > 0) return named[0];
    const byKindName = catalog.find((t) => !("name" in t) && t.kind === name);
    if (byKindName) return byKindName;
  }
  if (kind === "apply_patch" || kind === "local_shell" || kind === "shell") {
    return catalog.find((t) => t.kind === kind);
  }
  return undefined;
}

export function toolUseIds(kind: ToolKind): { id: string; callId: string } {
  switch (kind) {
    case "anthropic_tool_use": {
      const id = ids.toolu();
      return { id, callId: id };
    }
    case "openai_function":
      return { id: ids.fc(), callId: ids.call() };
    case "openai_custom":
      return { id: ids.ctc(), callId: ids.call() };
    case "apply_patch":
      return { id: ids.apc(), callId: ids.call() };
    case "local_shell":
      return { id: ids.lsc(), callId: ids.call() };
    case "shell":
      return { id: ids.shc(), callId: ids.call() };
  }
}

export function payloadFromDraft(tool: NormalizedTool, input: unknown): ToolPayload {
  const raw = draftInputText(input);
  const mode = inputModeFor(tool);
  const name = catalogName(tool);
  if (mode === "freeform") {
    if (!raw.trim() || !raw.includes("*** Begin Patch")) {
      throw new ToolDraftError(`${name}: paste a Begin Patch document (do not JSON.parse it)`);
    }
    return { form: "freeform", value: raw };
  }
  const value = parseJsonObject(raw, name);
  if (mode === "apply_patch") return { form: "apply_patch", operation: parseApplyPatchOp(value) };
  if (mode === "local_shell") return { form: "local_shell", action: parseLocalShell(value) };
  if (mode === "shell") return { form: "shell", action: parseShell(value) };
  assertRequired(tool, value);
  assertDangerousCommand(name, value);
  return { form: "json", value };
}

/** Build assistant blocks for one operator turn: optional preamble + N tool calls. */
export function blocksFromReply(catalog: NormalizedTool[], body: unknown): AssistantBlock[] {
  const rec = asRecord(body) ?? {};
  const text = typeof rec.text === "string" ? rec.text : "";
  if (rec.tools != null && !Array.isArray(rec.tools)) {
    throw new ToolDraftError("tools must be an array");
  }
  const drafts: OperatorToolDraft[] = [];
  if (Array.isArray(rec.tools)) {
    for (const item of rec.tools) {
      const t = asRecord(item);
      if (!t) throw new ToolDraftError("each tool draft must be an object");
      drafts.push({
        name: typeof t.name === "string" ? t.name : undefined,
        kind: isToolKind(t.kind) ? t.kind : undefined,
        input: t.input,
      });
    }
  }
  if (!text.trim() && drafts.length === 0) {
    throw new ToolDraftError("text or tools required");
  }
  const blocks: AssistantBlock[] = [];
  if (text.trim()) blocks.push({ type: "text", text });
  for (const draft of drafts) {
    const tool = findCatalogTool(catalog, draft);
    if (!tool) {
      throw new ToolDraftError(`unknown tool ${draft.name ?? draft.kind ?? "(unnamed)"}`);
    }
    const idsFor = toolUseIds(tool.kind);
    blocks.push({
      type: "tool_use",
      kind: tool.kind,
      id: idsFor.id,
      callId: idsFor.callId,
      name: "name" in tool ? tool.name : undefined,
      payload: payloadFromDraft(tool, draft.input),
    });
  }
  return blocks;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function draftInputText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input == null) return "";
  return pretty(input);
}

const PARAM_DESC_MAX = 80;
const TYPE_LABEL_MAX = 48;

const BUILTIN_PARAMS: Record<string, ToolParam[]> = {
  Bash: [
    { key: "command", type: "string", required: true },
    { key: "timeout", type: "number", required: false },
  ],
  Read: [{ key: "file_path", type: "string", required: true }],
  Edit: [
    { key: "file_path", type: "string", required: true },
    { key: "old_string", type: "string", required: true },
    { key: "new_string", type: "string", required: true },
  ],
  Write: [
    { key: "file_path", type: "string", required: true },
    { key: "content", type: "string", required: true },
  ],
  Glob: [{ key: "pattern", type: "string", required: true }],
  Grep: [
    { key: "pattern", type: "string", required: true },
    { key: "path", type: "string", required: false },
  ],
};

export function schemaTypeLabel(schema: unknown, depth = 0): string {
  const raw = schemaTypeLabelInner(schema, depth);
  return raw.length > TYPE_LABEL_MAX ? `${raw.slice(0, TYPE_LABEL_MAX - 1)}…` : raw;
}

function schemaTypeLabelInner(schema: unknown, depth: number): string {
  if (depth > 2) return "object";
  const rec = asRecord(schema);
  if (!rec) return "any";
  if (Array.isArray(rec.enum) && rec.enum.length > 0 && rec.enum.length <= 8) {
    return rec.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (rec.const !== undefined) return JSON.stringify(rec.const);
  if (Array.isArray(rec.anyOf) && rec.anyOf.length) {
    return rec.anyOf.slice(0, 4).map((s) => schemaTypeLabelInner(s, depth + 1)).join(" | ");
  }
  if (Array.isArray(rec.oneOf) && rec.oneOf.length) {
    return rec.oneOf.slice(0, 4).map((s) => schemaTypeLabelInner(s, depth + 1)).join(" | ");
  }
  if (typeof rec.$ref === "string") {
    const name = rec.$ref.split("/").pop();
    return name && name.length > 0 ? name : "object";
  }
  const ty = rec.type;
  if (Array.isArray(ty)) {
    return ty.filter((t): t is string => typeof t === "string").join(" | ") || "any";
  }
  if (ty === "array") {
    const inner = rec.items ? schemaTypeLabelInner(rec.items, depth + 1) : "any";
    return `${inner}[]`;
  }
  if (typeof ty === "string") return ty;
  return "any";
}

export function paramsFor(tool: NormalizedTool): ToolParam[] {
  const mode = inputModeFor(tool);
  if (mode === "apply_patch") {
    return [
      { key: "type", type: '"create_file" | "update_file" | "delete_file"', required: true },
      { key: "path", type: "string", required: true },
      { key: "diff", type: "string", required: false },
    ];
  }
  if (mode === "local_shell") {
    return [
      { key: "type", type: '"exec"', required: true },
      { key: "command", type: "string[]", required: true },
      { key: "env", type: "object", required: true },
      { key: "timeout_ms", type: "number", required: false },
      { key: "working_directory", type: "string", required: false },
    ];
  }
  if (mode === "shell") {
    return [
      { key: "commands", type: "string[]", required: true },
      { key: "timeout_ms", type: "number", required: false },
    ];
  }
  if (mode === "freeform") {
    return [{ key: "patch", type: "Begin Patch (text)", required: true }];
  }
  const schema = "inputSchema" in tool ? tool.inputSchema : undefined;
  const fromSchema = paramsFromSchema(schema);
  if (fromSchema.length) return fromSchema;
  return BUILTIN_PARAMS[catalogName(tool)] ?? [];
}

function paramsFromSchema(schema: unknown): ToolParam[] {
  const rec = asRecord(schema);
  if (!rec) return [];
  const props = asRecord(rec.properties) ?? {};
  const required = schemaRequiredKeys(schema);
  const requiredSet = new Set(required);
  const rest = Object.keys(props).filter((k) => !requiredSet.has(k));
  const keys = [...required, ...rest].slice(0, TEMPLATE_KEYS_MAX);
  const out: ToolParam[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const prop = props[key];
    const desc = asRecord(prop)?.description;
    out.push({
      key,
      type: schemaTypeLabel(prop),
      required: requiredSet.has(key),
      description: typeof desc === "string" && desc.trim() ? desc.trim().slice(0, PARAM_DESC_MAX) : undefined,
    });
  }
  return out;
}

function emptyFromSchema(schema: unknown): Record<string, unknown> | undefined {
  const rec = asRecord(schema);
  if (!rec) return undefined;
  const props = asRecord(rec.properties);
  const required = schemaRequiredKeys(schema);
  const keys = required.length > 0 ? required.slice(0, TEMPLATE_KEYS_MAX) : [];
  if (keys.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const prop = props ? asRecord(props[key]) : undefined;
    const ty = prop?.type;
    if (ty === "array") out[key] = [];
    else if (ty === "object") out[key] = {};
    else if (ty === "number" || ty === "integer") out[key] = 0;
    else if (ty === "boolean") out[key] = false;
    else out[key] = "";
  }
  return out;
}

function parseJsonObject(raw: string, name: string): unknown {
  if (!raw.trim()) throw new ToolDraftError(`${name}: arguments are required`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ToolDraftError(`${name}: arguments must be JSON`);
  }
}

function parseApplyPatchOp(value: unknown): ApplyPatchOp {
  const rec = asRecord(value);
  if (!rec) throw new ToolDraftError("apply_patch: expected an object");
  const path = typeof rec.path === "string" ? rec.path : "";
  if (!path.trim()) throw new ToolDraftError("apply_patch: path is required");
  if (rec.type === "delete_file") return { type: "delete_file", path };
  if (rec.type === "create_file" || rec.type === "update_file" || rec.type == null) {
    const diff = typeof rec.diff === "string" ? rec.diff : "";
    if (!diff.trim()) throw new ToolDraftError("apply_patch: diff is required");
    return { type: rec.type === "create_file" ? "create_file" : "update_file", path, diff };
  }
  throw new ToolDraftError("apply_patch: type must be create_file, update_file, or delete_file");
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((c) => String(c));
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function nonemptyCommands(list: string[]): boolean {
  return list.some((c) => c.trim().length > 0);
}

function parseLocalShell(value: unknown): LocalShellAction {
  const rec = asRecord(value) ?? {};
  const command = stringList(rec.command);
  if (!nonemptyCommands(command)) throw new ToolDraftError("local_shell: command is required");
  const envRec = asRecord(rec.env) ?? {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envRec)) env[k] = String(v);
  const action: LocalShellAction = { type: "exec", command, env };
  if (typeof rec.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec.user === "string") action.user = rec.user;
  if (typeof rec.working_directory === "string") action.working_directory = rec.working_directory;
  return action;
}

function parseShell(value: unknown): ShellAction {
  const rec = asRecord(value) ?? {};
  const commands = stringList(rec.commands);
  if (!nonemptyCommands(commands)) throw new ToolDraftError("shell: commands is required");
  const action: ShellAction = { commands };
  if (typeof rec.timeout_ms === "number") action.timeout_ms = rec.timeout_ms;
  if (typeof rec.max_output_length === "number") action.max_output_length = rec.max_output_length;
  return action;
}

function assertRequired(tool: NormalizedTool, value: unknown): void {
  const schema = "inputSchema" in tool ? tool.inputSchema : undefined;
  const required = schemaRequiredKeys(schema);
  if (required.length === 0) return;
  const rec = asRecord(value);
  if (!rec) throw new ToolDraftError(`${catalogName(tool)}: arguments must be an object`);
  const missing = required.filter((k) => rec[k] === undefined);
  if (missing.length) {
    throw new ToolDraftError(`${catalogName(tool)}: missing required ${missing.join(", ")}`);
  }
}

function assertDangerousCommand(name: string, value: unknown): void {
  if (name !== "Bash") return;
  const rec = asRecord(value);
  const command = rec && typeof rec.command === "string" ? rec.command : "";
  if (!command.trim()) throw new ToolDraftError("Bash: command is required");
}
