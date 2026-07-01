import { describe, expect, test } from "bun:test";
import { parseHangSeconds } from "./hang-registry.ts";

describe("parseHangSeconds", () => {
  test("defaults to 60", () => {
    expect(parseHangSeconds(undefined)).toBe(60);
    expect(parseHangSeconds("")).toBe(60);
  });

  test("rejects non-integers", () => {
    expect(() => parseHangSeconds("0")).toThrow();
    expect(() => parseHangSeconds("1.5")).toThrow();
    expect(() => parseHangSeconds("3601")).toThrow();
  });
});
