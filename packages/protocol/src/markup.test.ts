import { describe, expect, test } from "bun:test";
import { isMetaTag, parseEnvPairs, splitMarkup } from "./markup.ts";

describe("splitMarkup", () => {
  test("leaves plain text alone", () => {
    const segs = splitMarkup("hello from the user");
    expect(segs).toEqual([{ kind: "text", attrs: {}, text: "hello from the user" }]);
  });

  test("splits a system-reminder ahead of the real user text", () => {
    const segs = splitMarkup(
      "<system-reminder>\nDo not mention this.\n</system-reminder>\nplease fix the bug",
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]?.kind).toBe("tag");
    expect(segs[0]?.name).toBe("system-reminder");
    expect(segs[0]?.text).toContain("Do not mention this.");
    expect(segs[1]?.kind).toBe("text");
    expect(segs[1]?.text.trim()).toBe("please fix the bug");
  });

  test("parses env and command tags", () => {
    const segs = splitMarkup(
      "<env>\nWorking directory: /tmp/proj\nPlatform: darwin\n</env>\n<command-name>/commit</command-name>",
    );
    expect(segs.map((s) => s.name ?? "text")).toEqual(["env", "text", "command-name"]);
    expect(segs[0]?.text).toContain("Working directory");
    expect(segs[2]?.text).toBe("/commit");
  });

  test("keeps a broken angle bracket as text", () => {
    const segs = splitMarkup("a < b and c > d");
    expect(segs).toHaveLength(1);
    expect(segs[0]?.kind).toBe("text");
  });
});

describe("isMetaTag / parseEnvPairs", () => {
  test("known agent tags are meta", () => {
    expect(isMetaTag("system-reminder")).toBe(true);
    expect(isMetaTag("ENV")).toBe(true);
    expect(isMetaTag("user")).toBe(false);
  });

  test("env lines become key/value pairs", () => {
    const pairs = parseEnvPairs("Working directory: /tmp\nPlatform: darwin\n");
    expect(pairs).toEqual([
      { key: "Working directory", value: "/tmp" },
      { key: "Platform", value: "darwin" },
    ]);
  });
});
