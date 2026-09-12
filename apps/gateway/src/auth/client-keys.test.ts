import { describe, expect, test } from "bun:test";
import { isMintedApiKey, mintApiKeyPlaintext } from "./client-keys.ts";

describe("mintApiKeyPlaintext", () => {
  test("is 26 chars, sk-carbon- prefix, and unique", () => {
    const a = mintApiKeyPlaintext();
    const b = mintApiKeyPlaintext();
    expect(a).toHaveLength(26);
    expect(b).toHaveLength(26);
    expect(a.startsWith("sk-carbon-")).toBe(true);
    expect(isMintedApiKey(a)).toBe(true);
    expect(isMintedApiKey(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(isMintedApiKey("sk-carbon-local")).toBe(false);
    expect(isMintedApiKey("sk-carbon-xZ37kcWJQvUVOiWAW4QnofeuZWbzWHMo")).toBe(false);
  });
});
