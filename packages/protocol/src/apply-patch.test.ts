import { describe, expect, test } from "bun:test";
import { functionCallArguments, pickRequiredStringKey, wrapFunctionApplyPatchArgs } from "./apply-patch.ts";

describe("function apply_patch wrapping", () => {
  test("wraps Begin Patch into schema required string key", () => {
    const schema = {
      type: "object",
      required: ["input"],
      properties: { input: { type: "string" } },
    };
    const patch = "*** Begin Patch\n*** Update File: a.py\n@@\n-x\n+y\n*** End Patch\n";
    const args = wrapFunctionApplyPatchArgs(schema, patch);
    expect(args.startsWith("***")).toBe(false);
    expect(JSON.parse(args)).toEqual({ input: patch });
    expect(pickRequiredStringKey(schema)).toBe("input");
  });

  test("functionCallArguments never emits raw Begin Patch for apply_patch", () => {
    const patch = "*** Begin Patch\n*** End Patch\n";
    const args = functionCallArguments("apply_patch", { form: "freeform", value: patch }, undefined);
    const parsed = JSON.parse(args) as { input: string };
    expect(parsed.input).toBe(patch);
  });
});
