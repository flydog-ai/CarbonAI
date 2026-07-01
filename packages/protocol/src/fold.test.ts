import { describe, expect, test } from "bun:test";
import { eventsFromBlocks } from "./events-from-blocks.ts";
import { fold } from "./fold.ts";
import { estimateTextTokens } from "./tokens.ts";

describe("fold / eventsFromBlocks", () => {
  test("text round-trip", () => {
    const events = eventsFromBlocks({
      jobId: "job_1",
      vendorMessageId: "msg_1",
      model: "carbon-default",
      createdAt: 1,
      inputTokens: 10,
      blocks: [{ type: "text", text: "你好😀" }],
    });
    const out = fold(events);
    expect(out.blocks).toEqual([{ type: "text", text: "你好😀" }]);
    expect(out.stopReason).toBe("end_turn");
    expect(out.vendorMessageId).toBe("msg_1");
    expect(out.outputTokens).toBe(estimateTextTokens("你好😀"));
  });

  test("tool_use implies stop_reason tool_use", () => {
    const events = eventsFromBlocks({
      jobId: "job_1",
      vendorMessageId: "msg_1",
      model: "m",
      createdAt: 1,
      inputTokens: 3,
      blocks: [
        { type: "text", text: "running" },
        {
          type: "tool_use",
          kind: "anthropic_tool_use",
          id: "toolu_1",
          callId: "call_1",
          name: "Bash",
          payload: { form: "json", value: { command: "ls" } },
        },
      ],
    });
    const out = fold(events);
    expect(out.stopReason).toBe("tool_use");
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[1]).toMatchObject({ type: "tool_use", name: "Bash" });
  });
});
