import { describe, expect, test } from "bun:test";
import { emptyNormalizedRequest } from "@carbon-ai/protocol";
import { flattenContext, flattenMessages, pageContext } from "./context.ts";

describe("operator context", () => {
  test("system first, collapsed, then user text", () => {
    const req = emptyNormalizedRequest({
      system: [{ type: "text", text: "you are a gateway" }],
      messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
      tools: [{ kind: "anthropic_tool_use", name: "Bash", vendorRaw: {} }],
    });
    const blocks = flattenContext(req);
    expect(blocks[0]?.role).toBe("system");
    expect(blocks[0]?.lane).toBe("system");
    expect(blocks[0]?.collapsed).toBe(true);
    expect(blocks.some((b) => b.kind === "tools" && b.excerpt.includes("Bash"))).toBe(true);
    expect(blocks.at(-1)?.excerpt).toBe("hello");
    expect(blocks.at(-1)?.lane).toBe("user");
  });

  test("pages messages without counting the system pack", () => {
    const req = emptyNormalizedRequest({
      system: [{ type: "text", text: "huge system prompt" }],
      messages: [
        { role: "user", parts: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] },
      ],
    });
    const p1 = pageContext("job_x", req, "0", 2);
    expect(p1.system.some((b) => b.excerpt.includes("huge system prompt"))).toBe(true);
    expect(p1.blocks).toHaveLength(2);
    expect(p1.blocks[0]?.excerpt).toBe("a");
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).toBe("2");
    const p2 = pageContext("job_x", req, p1.nextCursor ?? "2", 2);
    expect(p2.blocks[0]?.excerpt).toBe("c");
    expect(p2.hasMore).toBe(false);
  });

  test("system-reminder is meta, leftover text is the user bubble", () => {
    const req = emptyNormalizedRequest({
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "<system-reminder>\nDo not mention this.\n</system-reminder>\nplease fix the login",
            },
          ],
        },
      ],
    });
    const chat = flattenMessages(req);
    expect(chat.some((b) => b.lane === "meta" && b.kind === "system-reminder")).toBe(true);
    expect(chat.some((b) => b.lane === "user" && b.excerpt.includes("please fix the login"))).toBe(true);
  });

  test("env tag becomes key/value fields; slash commands coalesce", () => {
    const req = emptyNormalizedRequest({
      system: [
        {
          type: "text",
          text: "<env>\nWorking directory: /tmp/proj\nPlatform: darwin\n</env>",
        },
      ],
      messages: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "<command-name>/commit</command-name><command-message>commit</command-message><command-args>-m hi</command-args>",
            },
          ],
        },
      ],
    });
    const sys = flattenContext(req).filter((b) => b.kind === "env");
    expect(sys[0]?.fields).toEqual([
      { key: "Working directory", value: "/tmp/proj" },
      { key: "Platform", value: "darwin" },
    ]);
    const cmd = flattenMessages(req).find((b) => b.kind === "command");
    expect(cmd?.excerpt).toContain("/commit");
    expect(cmd?.excerpt).toContain("commit");
    expect(cmd?.excerpt).toContain("args -m hi");
  });

  test("tail page starts from the latest messages", () => {
    const req = emptyNormalizedRequest({
      messages: [
        { role: "user", parts: [{ type: "text", text: "one" }] },
        { role: "assistant", parts: [{ type: "text", text: "two" }] },
        { role: "user", parts: [{ type: "text", text: "three" }] },
        { role: "assistant", parts: [{ type: "text", text: "four" }] },
        { role: "user", parts: [{ type: "text", text: "five" }] },
      ],
    });
    const page = pageContext("job_x", req, "0", 2, undefined, { tail: true });
    expect(page.blocks.map((b) => b.excerpt)).toEqual(["four", "five"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("3");
    const earlier = pageContext("job_x", req, page.nextCursor ?? "3", 2, undefined, { tail: true });
    expect(earlier.blocks.map((b) => b.excerpt)).toEqual(["two", "three"]);
    expect(earlier.hasMore).toBe(true);
    const oldest = pageContext("job_x", req, earlier.nextCursor ?? "1", 2, undefined, { tail: true });
    expect(oldest.blocks.map((b) => b.excerpt)).toEqual(["one"]);
    expect(oldest.hasMore).toBe(false);
  });

  test("operator reply is an assistant bubble with source reply", () => {
    const req = emptyNormalizedRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    });
    const page = pageContext("job_x", req, "0", 20, {
      vendorMessageId: "msg_1",
      model: "carbon-default",
      createdAt: 1,
      blocks: [{ type: "text", text: "pong from desk" }],
      stopReason: "end_turn",
      inputTokens: 1,
      outputTokens: 3,
    });
    expect(page.reply[0]?.lane).toBe("assistant");
    expect(page.reply[0]?.source).toBe("reply");
    expect(page.reply[0]?.excerpt).toBe("pong from desk");
  });

  test("context page includes the client's tool catalog", () => {
    const req = emptyNormalizedRequest({
      tools: [{ kind: "anthropic_tool_use", name: "Bash", description: "run a command", vendorRaw: {} }],
    });
    const page = pageContext("job_x", req, "0", 20);
    expect(page.tools).toHaveLength(1);
    expect(page.tools[0]?.name).toBe("Bash");
    expect(page.tools[0]?.template).toContain("command");
  });

  test("tool_use reply is a titled tool card, not a JSON blob with the name glued on", () => {
    const req = emptyNormalizedRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "ls" }] }],
    });
    const page = pageContext("job_x", req, "0", 20, {
      vendorMessageId: "msg_1",
      model: "carbon-default",
      createdAt: 1,
      blocks: [
        {
          type: "tool_use",
          kind: "anthropic_tool_use",
          id: "toolu_1",
          callId: "toolu_1",
          name: "Bash",
          payload: { form: "json", value: { command: "ls" } },
        },
      ],
      stopReason: "tool_use",
      inputTokens: 1,
      outputTokens: 3,
    });
    expect(page.reply[0]?.kind).toBe("tool_use");
    expect(page.reply[0]?.title).toBe("Bash");
    expect(page.reply[0]?.excerpt).toContain('"command": "ls"');
    expect(page.reply[0]?.collapsed).toBe(false);
  });
});
