import { describe, expect, test } from "bun:test";
import { resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  test("saved preference wins over the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("with no save, follows prefers-color-scheme", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("auto", true)).toBe("dark");
  });
});
