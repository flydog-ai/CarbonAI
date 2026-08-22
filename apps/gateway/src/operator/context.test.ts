import { describe, expect, test } from "bun:test";
import { emptyNormalizedRequest } from "@carbon-ai/protocol";
import { flattenContext, pageContext } from "./context.ts";

describe("operator context", () => {
  test("system first, collapsed, then user text", () => {
    const req = emptyNormalizedRequest({
      system: [{ type: "text", text: "you are a gateway" }],
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      tools: [{ kind: "anthropic_tool_use", name: "Bash", vendorRaw: {} }],
    });
    const blocks = flattenContext(req);
    expect(blocks[0]?.role).toBe("system");
    expect(blocks[0]?.collapsed).toBe(true);
    expect(blocks.some((b) => b.kind === "tools" && b.excerpt.includes("Bash"))).toBe(true);
    expect(blocks.at(-1)?.excerpt).toBe("hello");
  });

  test("pages with opaque decimal cursor", () => {
    const req = emptyNormalizedRequest({
      messages: [
        { role: "user", parts: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] },
      ],
    });
    const p1 = pageContext("job_x", req, "0", 2);
    expect(p1.blocks).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).toBe("2");
    const p2 = pageContext("job_x", req, p1.nextCursor ?? "2", 2);
    expect(p2.blocks[0]?.excerpt).toBe("c");
    expect(p2.hasMore).toBe(false);
  });
});
