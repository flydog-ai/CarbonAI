import { describe, expect, test } from "bun:test";
import { filterTools, formatParams, groupThreads, initials, isLive, secretPrefix, threadKey } from "./lib.ts";
import type { PublicTool } from "./types.ts";
import type { Job } from "./types.ts";

function job(over: Partial<Job> & { id: string }): Job {
  return {
    status: "completed",
    createdAt: 1,
    ...over,
  };
}

describe("thread grouping", () => {
  test("threadKey prefers threadId", () => {
    expect(threadKey({ id: "job_1" })).toBe("job_1");
    expect(threadKey({ id: "job_1", threadId: "thr_a" })).toBe("thr_a");
  });

  test("same threadId collapses to the live job", () => {
    const rows = groupThreads([
      job({ id: "old", threadId: "thr_a", status: "completed", createdAt: 1, lastUserPreview: "hi", turnCount: 1 }),
      job({ id: "live", threadId: "thr_a", status: "pending", createdAt: 2, lastUserPreview: "next", turnCount: 3 }),
      job({ id: "other", threadId: "thr_b", status: "completed", createdAt: 3, lastUserPreview: "else" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("other");
    expect(rows[1]?.id).toBe("live");
    expect(rows[1]?.turnCount).toBe(3);
    expect(isLive(rows[1]!)).toBe(true);
  });

  test("initials uses the first character", () => {
    expect(initials("claude")).toBe("C");
    expect(initials("碳基")).toBe("碳");
    expect(initials("")).toBe("?");
  });
});

describe("filterTools", () => {
  const tools: PublicTool[] = [
    { key: "0", kind: "anthropic_tool_use", name: "Bash", required: ["command"], inputMode: "json", template: "{}" },
    { key: "1", kind: "anthropic_tool_use", name: "mcp__github__list_issues", description: "list GitHub issues", required: [], inputMode: "json", template: "{}" },
    { key: "2", kind: "local_shell", name: "local_shell", required: [], inputMode: "local_shell", template: "{}" },
  ];

  test("empty query keeps the full catalog", () => {
    expect(filterTools(tools, "  ")).toHaveLength(3);
  });

  test("tokens match name, kind, or description", () => {
    expect(filterTools(tools, "bash").map((t) => t.name)).toEqual(["Bash"]);
    expect(filterTools(tools, "github issues").map((t) => t.name)).toEqual(["mcp__github__list_issues"]);
    expect(filterTools(tools, "local_shell").map((t) => t.name)).toEqual(["local_shell"]);
  });

  test("108-style catalogs stay filterable without dropping unmatched leftovers", () => {
    const many = Array.from({ length: 108 }, (_, i) => ({
      ...tools[0]!,
      key: String(i),
      name: i === 41 ? "Read" : `tool_${i}`,
    }));
    expect(filterTools(many, "").length).toBe(108);
    expect(filterTools(many, "read").map((t) => t.name)).toEqual(["Read"]);
    expect(filterTools(many, "nope")).toEqual([]);
  });

  test("formatParams shows JSON types and marks optional keys", () => {
    expect(
      formatParams([
        { key: "command", type: "string", required: true },
        { key: "timeout", type: "number", required: false },
      ]),
    ).toBe("command: string · timeout: number?");
  });
});

describe("secretPrefix", () => {
  test("masks with ASCII dots so a copied prefix is still a ByteString", () => {
    const p = secretPrefix("sk-carbon-abcdefghijklmnopqrstuv");
    expect(p.includes("\u2026")).toBe(false);
    expect(p).toContain("...");
    expect([...p].every((ch) => (ch.codePointAt(0) ?? 0) < 256)).toBe(true);
  });
});
