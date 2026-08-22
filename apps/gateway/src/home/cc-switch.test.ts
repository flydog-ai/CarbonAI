import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "@carbon-ai/config";
import {
  LOCAL_API_KEY,
  buildCcSwitchClaudeImportHref,
  clientApiKey,
  preferLoopbackOrigin,
  siteOrigin,
} from "./cc-switch.ts";

describe("preferLoopbackOrigin", () => {
  test("rewrites localhost and ::1 to 127.0.0.1", () => {
    expect(preferLoopbackOrigin("http://localhost:12580/")).toBe("http://127.0.0.1:12580");
    expect(preferLoopbackOrigin("http://[::1]:12580/")).toBe("http://127.0.0.1:12580");
    expect(preferLoopbackOrigin("http://127.0.0.1:12580/")).toBe("http://127.0.0.1:12580");
  });
});

describe("siteOrigin", () => {
  test("uses configured public origin when set", () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.site.publicOrigin = "https://ai.example";
    expect(siteOrigin(cfg, "http://localhost:12580/console")).toBe("https://ai.example");
  });

  test("falls back to the request origin", () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    expect(siteOrigin(cfg, "http://localhost:12580/")).toBe("http://127.0.0.1:12580");
  });
});

describe("buildCcSwitchClaudeImportHref", () => {
  test("imports a Claude Code provider without /v1", () => {
    const href = buildCcSwitchClaudeImportHref({
      name: "Carbon AI",
      endpoint: "http://127.0.0.1:12580",
      apiKey: "sk-test",
      model: "carbon-default",
    });
    expect(href.startsWith("ccswitch://v1/import?")).toBe(true);
    const qs = new URLSearchParams(href.slice("ccswitch://v1/import?".length));
    expect(qs.get("resource")).toBe("provider");
    expect(qs.get("app")).toBe("claude");
    expect(qs.get("name")).toBe("Carbon AI");
    expect(qs.get("endpoint")).toBe("http://127.0.0.1:12580");
    expect(qs.get("endpoint")?.endsWith("/v1")).toBe(false);
    expect(qs.get("apiKey")).toBe("sk-test");
    expect(qs.get("model")).toBe("carbon-default");
    expect(qs.get("haikuModel")).toBe("carbon-default");
    expect(qs.get("sonnetModel")).toBe("carbon-default");
    expect(qs.get("opusModel")).toBe("carbon-default");
    expect(qs.get("enabled")).toBe("true");
  });

  test("always includes apiKey; falls back to local key", () => {
    expect(clientApiKey(DEFAULT_CONFIG)).toBe(LOCAL_API_KEY);
    expect(clientApiKey(DEFAULT_CONFIG, true)).toBeUndefined();
    const href = buildCcSwitchClaudeImportHref({
      name: "Carbon AI",
      endpoint: "http://127.0.0.1:12580",
      apiKey: clientApiKey(DEFAULT_CONFIG) ?? LOCAL_API_KEY,
      model: "carbon-default",
    });
    const qs = new URLSearchParams(href.slice("ccswitch://v1/import?".length));
    expect(qs.get("apiKey")).toBe("sk-carbon-local");
  });
});
