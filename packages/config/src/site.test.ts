import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "./types.ts";
import { applySettingsKv, normalizePublicOrigin } from "./site.ts";

describe("normalizePublicOrigin", () => {
  test("accepts empty, http(s) URLs, and host:port", () => {
    expect(normalizePublicOrigin("")).toBe("");
    expect(normalizePublicOrigin("https://ai.example/")).toBe("https://ai.example");
    expect(normalizePublicOrigin("127.0.0.1:12580")).toBe("http://127.0.0.1:12580");
    expect(normalizePublicOrigin("ftp://nope")).toEqual({ error: "origin must be http or https" });
  });
});

describe("applySettingsKv", () => {
  test("overlays site fields onto config", () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    applySettingsKv(cfg, { "site.name": "Desk", "site.public_origin": "https://ai.example" });
    expect(cfg.site.name).toBe("Desk");
    expect(cfg.site.publicOrigin).toBe("https://ai.example");
  });
});
