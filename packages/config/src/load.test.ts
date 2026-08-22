import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandHome, loadConfig } from "./load.ts";
import { DEFAULT_CONFIG } from "./types.ts";

describe("expandHome", () => {
  test("expands ~/", () => {
    const expanded = expandHome("~/.carbon-ai");
    expect(expanded.startsWith("/")).toBe(true);
    expect(expanded.endsWith("/.carbon-ai") || expanded.endsWith(".carbon-ai")).toBe(true);
    expect(expanded.includes("~")).toBe(false);
  });
});

describe("loadConfig", () => {
  test("defaults include user decisions (max_active=8, responses heartbeat both)", () => {
    expect(DEFAULT_CONFIG.server.port).toBe(12580);
    expect(DEFAULT_CONFIG.jobs.maxActive).toBe(8);
    expect(DEFAULT_CONFIG.openaiResponses.heartbeat).toBe("both");
  });

  test("reads carbon.toml from cwd walk and env overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-cfg-"));
    writeFileSync(
      join(dir, "carbon.toml"),
      `
[server]
port = 9999
data_dir = "~/carbon-test"

[jobs]
max_active = 8

[openai_responses]
heartbeat = "both"
`,
      "utf8",
    );
    const cfg = loadConfig({
      cwd: dir,
      env: { CARBON_PORT: "1234" },
      generateOperatorTokenIfEmpty: false,
    });
    expect(cfg.server.port).toBe(1234);
    expect(cfg.jobs.maxActive).toBe(8);
    expect(cfg.openaiResponses.heartbeat).toBe("both");
    expect(cfg.server.dataDir.includes("~")).toBe(false);
  });

  test("CARBON_API_KEYS is JSON not colon-separated", () => {
    const cfg = loadConfig({
      cwd: mkdtempSync(join(tmpdir(), "carbon-cfg-")),
      env: {
        CARBON_API_KEYS: JSON.stringify([
          { label: "Claude Code", key: "sk:with:colons" },
        ]),
      },
      generateOperatorTokenIfEmpty: false,
    });
    expect(cfg.auth.apiKeys).toEqual([{ label: "Claude Code", key: "sk:with:colons" }]);
  });

  test("bootstrap username and password from toml and env", () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-cfg-"));
    writeFileSync(
      join(dir, "carbon.toml"),
      `
[auth]
bootstrap_username = "root"
bootstrap_password = "fromfile"
`,
      "utf8",
    );
    const cfg = loadConfig({
      cwd: dir,
      env: { CARBON_BOOTSTRAP_PASSWORD: "fromenv" },
      generateOperatorTokenIfEmpty: false,
    });
    expect(cfg.auth.bootstrapUsername).toBe("root");
    expect(cfg.auth.bootstrapPassword).toBe("fromenv");
  });

  test("site name and public origin from toml and env", () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-site-"));
    writeFileSync(
      join(dir, "carbon.toml"),
      `
[site]
name = "From File"
name_zh = "来自文件"
public_origin = "http://example.test:8080/"
`,
      "utf8",
    );
    const cfg = loadConfig({
      cwd: dir,
      env: { CARBON_PUBLIC_ORIGIN: "https://live.example" },
      generateOperatorTokenIfEmpty: false,
    });
    expect(cfg.site.name).toBe("From File");
    expect(cfg.site.nameZh).toBe("来自文件");
    expect(cfg.site.publicOrigin).toBe("https://live.example");
  });

  test("CARBON_CONFIG points at an explicit file", () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-cfg-"));
    mkdirSync(join(dir, "nested"), { recursive: true });
    const file = join(dir, "custom.toml");
    writeFileSync(file, `[server]\nport = 7777\n`, "utf8");
    const cfg = loadConfig({
      cwd: join(dir, "nested"),
      env: { CARBON_CONFIG: file },
      generateOperatorTokenIfEmpty: false,
    });
    expect(cfg.server.port).toBe(7777);
  });
});
