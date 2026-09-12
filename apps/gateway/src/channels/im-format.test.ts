import { describe, expect, test } from "bun:test";
import { formatDeskLink, formatHelp, formatList, formatNotify, parseImCommand } from "./im-format.ts";

describe("parseImCommand", () => {
  test("slash commands and chinese aliases", () => {
    expect(parseImCommand("/list")).toEqual({ type: "list" });
    expect(parseImCommand("/ls")).toEqual({ type: "list" });
    expect(parseImCommand("/列表")).toEqual({ type: "list" });
    expect(parseImCommand("列表")).toEqual({ type: "list" });
    expect(parseImCommand("/cancel")).toEqual({ type: "cancel" });
    expect(parseImCommand("取消")).toEqual({ type: "cancel" });
    expect(parseImCommand("/help")).toEqual({ type: "help" });
    expect(parseImCommand("/desk")).toEqual({ type: "desk" });
    expect(parseImCommand("/nope")).toEqual({ type: "unknown", name: "nope" });
  });

  test("numbered reply with slash or 1. body", () => {
    expect(parseImCommand("/1 哈哈")).toEqual({ type: "reply", index: 0, body: "哈哈" });
    expect(parseImCommand("1 哈哈")).toEqual({ type: "reply", index: 0, body: "哈哈" });
    expect(parseImCommand("2、好的")).toEqual({ type: "reply", index: 1, body: "好的" });
    expect(parseImCommand("哈哈")).toEqual({ type: "reply", body: "哈哈" });
  });
});

describe("formatNotify", () => {
  test("card layout uses guest id, not the desk username", () => {
    const text = formatNotify({
      callerLabel: "G-7K3M",
      clientKind: "claude-code",
      lastUserPreview: "你好你",
      visitorId: "vis_1",
    });
    expect(text).toContain("【新会话】");
    expect(text).toContain("Claude Code · G-7K3M");
    expect(text).toContain("你好你");
    expect(text).toContain("/list");
    expect(text).not.toContain("admin");
    expect(text).not.toContain("/console");
  });

  test("named-key legacy without guest id hides the account name", () => {
    const text = formatNotify({
      callerLabel: "admin",
      clientKind: "claude-code",
      lastUserPreview: "你谁呀?",
    });
    expect(text).toContain("Claude Code");
    expect(text).not.toContain("admin");
  });
});

describe("formatList / help / desk", () => {
  test("list and help mention slash commands", () => {
    expect(formatList([])).toContain("/help");
    expect(formatHelp()).toContain("/list");
    expect(formatDeskLink("https://carbon.yangyongan.com")).toBe(
      "工作台（登录你自己的账号）：\nhttps://carbon.yangyongan.com/console",
    );
  });
});
