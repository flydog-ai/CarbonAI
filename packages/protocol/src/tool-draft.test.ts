import { describe, expect, test } from "bun:test";
import { emptyNormalizedRequest } from "./events.ts";
import {
  BEGIN_PATCH_TEMPLATE,
  blocksFromReply,
  emptyValue,
  hydrateToolValues,
  initialAssembled,
  payloadFromDraft,
  publicTools,
  schemaTypeLabel,
  serializeToolValues,
  templateFor,
  ToolDraftError,
} from "./tool-draft.ts";

const bash = {
  kind: "anthropic_tool_use" as const,
  name: "Bash",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: { command: { type: "string" }, timeout: { type: "number" } },
  },
  vendorRaw: {},
};

const fnPatch = {
  kind: "openai_function" as const,
  name: "apply_patch",
  inputSchema: { type: "object", required: ["input"], properties: { input: { type: "string" } } },
  vendorRaw: {},
};

describe("tool drafts", () => {
  test("publicTools expose kind, required keys, and a clickable template", () => {
    const catalog = publicTools([
      bash,
      { kind: "local_shell", vendorRaw: {} },
      fnPatch,
    ]);
    expect(catalog).toHaveLength(3);
    expect(catalog[0]).toMatchObject({ name: "Bash", kind: "anthropic_tool_use", required: ["command"], inputMode: "json" });
    expect(catalog[0]?.params).toMatchObject([
      { key: "command", type: "string", required: true, widget: "textarea" },
      { key: "timeout", type: "number", required: false, widget: "number" },
    ]);
    expect(catalog[0]?.template).toContain('"command"');
    expect(catalog[1]).toMatchObject({ name: "local_shell", inputMode: "local_shell" });
    expect(catalog[1]?.params.some((p) => p.key === "command" && p.type === "string[]" && p.required)).toBe(true);
    expect(catalog[1]?.template).toContain('"env"');
    expect(catalog[2]?.inputMode).toBe("freeform");
    expect(catalog[2]?.template).toContain("*** Begin Patch");
  });

  test("Claude named tools get built-in templates when schema has no properties", () => {
    const t = templateFor({ kind: "anthropic_tool_use", name: "Read", vendorRaw: {} });
    expect(JSON.parse(t)).toEqual({ file_path: "" });
  });

  test("blocksFromReply emits preamble + N tool_use; stop is for the engine", () => {
    const blocks = blocksFromReply([bash], {
      text: "looking around",
      tools: [{ name: "Bash", input: { command: "ls" } }],
    });
    expect(blocks[0]).toEqual({ type: "text", text: "looking around" });
    expect(blocks[1]).toMatchObject({
      type: "tool_use",
      kind: "anthropic_tool_use",
      name: "Bash",
      payload: { form: "json", value: { command: "ls" } },
    });
    expect(blocks[1] && blocks[1].type === "tool_use" && blocks[1].id.startsWith("toolu_")).toBe(true);
  });

  test("empty Bash.command is rejected; text-only still works", () => {
    expect(() =>
      blocksFromReply([bash], { tools: [{ name: "Bash", input: '{"command":""}' }] }),
    ).toThrow(ToolDraftError);
    const textOnly = blocksFromReply([bash], { text: "done" });
    expect(textOnly).toEqual([{ type: "text", text: "done" }]);
  });

  test("unknown tool and empty turn are rejected", () => {
    expect(() => blocksFromReply([bash], { tools: [{ name: "Nope", input: "{}" }] })).toThrow(/unknown tool/);
    expect(() => blocksFromReply([bash], { text: "  " })).toThrow(/text or tools required/);
  });

  test("function apply_patch stays freeform; never JSON.parse the patch", () => {
    const patch = BEGIN_PATCH_TEMPLATE;
    const payload = payloadFromDraft(fnPatch, patch);
    expect(payload).toEqual({ form: "freeform", value: patch });
    expect(() => payloadFromDraft(fnPatch, '{"input":"nope"}')).toThrow(/Begin Patch/);
  });

  test("built-in apply_patch uses the hunk JSON, not Begin Patch wrapping", () => {
    const tool = { kind: "apply_patch" as const, vendorRaw: {} };
    const payload = payloadFromDraft(tool, {
      type: "update_file",
      path: "a.ts",
      diff: "@@\n-x\n+y",
    });
    expect(payload).toEqual({
      form: "apply_patch",
      operation: { type: "update_file", path: "a.ts", diff: "@@\n-x\n+y" },
    });
  });

  test("local_shell always has env; empty command rejected", () => {
    const tool = { kind: "local_shell" as const, vendorRaw: {} };
    const payload = payloadFromDraft(tool, { type: "exec", command: ["pwd"] });
    expect(payload).toEqual({
      form: "local_shell",
      action: { type: "exec", command: ["pwd"], env: {} },
    });
    expect(() => payloadFromDraft(tool, { command: [] })).toThrow(/command is required/);
  });

  test("schema required keys are checked", () => {
    expect(() => payloadFromDraft(bash, { timeout: 1 })).toThrow(/missing required command/);
  });

  test("catalog from a request matches publicTools", () => {
    const req = emptyNormalizedRequest({ tools: [bash] });
    expect(publicTools(req.tools)[0]?.name).toBe("Bash");
  });

  test("schemaTypeLabel covers enum, array, and union", () => {
    expect(schemaTypeLabel({ type: "string" })).toBe("string");
    expect(schemaTypeLabel({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(schemaTypeLabel({ enum: ["create_file", "update_file"] })).toBe('"create_file" | "update_file"');
    expect(schemaTypeLabel({ type: ["string", "null"] })).toBe("string | null");
  });

  test("serializeToolValues keeps required fields and skips empty optional ones", () => {
    const params = publicTools([bash])[0]!.params;
    expect(initialAssembled(params)).toEqual(["command"]);
    const assembled = ["command", "timeout"];
    const body = serializeToolValues("json", params, assembled, { command: "ls", timeout: "" });
    expect(JSON.parse(body)).toEqual({ command: "ls" });
    expect(emptyValue(params[0]!)).toBe("");
    const hydrated = hydrateToolValues("json", params, '{"command":"pwd","timeout":5}');
    expect(hydrated.assembled).toEqual(["command", "timeout"]);
    expect(hydrated.values).toEqual({ command: "pwd", timeout: 5 });
  });

  test("enum and list widgets assemble from schema", () => {
    const catalog = publicTools([
      {
        kind: "anthropic_tool_use",
        name: "mode_tool",
        inputSchema: {
          type: "object",
          required: ["mode", "tags"],
          properties: {
            mode: { type: "string", enum: ["fast", "slow"], description: "how hard to try" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "integer", minimum: 1, maximum: 10 },
          },
        },
        vendorRaw: {},
      },
    ]);
    const params = catalog[0]!.params;
    expect(params[0]).toMatchObject({ key: "mode", widget: "enum", enumValues: ["fast", "slow"], required: true });
    expect(params[1]).toMatchObject({ key: "tags", widget: "list", type: "string[]", required: true });
    expect(params[2]).toMatchObject({ key: "limit", widget: "number", minimum: 1, maximum: 10, required: false });
    const json = serializeToolValues("json", params, ["mode", "tags"], { mode: "fast", tags: ["a", "b"] });
    expect(JSON.parse(json)).toEqual({ mode: "fast", tags: ["a", "b"] });
  });

  test("optional-only schemas do not dump every property into the click template", () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) properties[`field_${i}`] = { type: "string" };
    const t = templateFor({
      kind: "anthropic_tool_use",
      name: "mcp__x__huge",
      inputSchema: { type: "object", properties },
      vendorRaw: {},
    });
    expect(JSON.parse(t)).toEqual({});
  });
});
