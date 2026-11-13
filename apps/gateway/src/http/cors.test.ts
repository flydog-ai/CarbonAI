import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "../app.ts";
import { JobEngine } from "../job/engine.ts";
import { listen } from "../listen.ts";
import { corsOrigin, isModelApiPath } from "./cors.ts";
import { isSseContentType } from "./sse-headers.ts";

function pickPort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  if (!port) throw new Error("no probe port");
  return port;
}

async function withSrv(over: (c: Config) => void, fn: (url: string) => Promise<void>): Promise<void> {
  const conf = structuredClone(DEFAULT_CONFIG);
  conf.auth.apiKeys = [{ label: "test", key: "sk-carbon-local" }];
  over(conf);
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-cors-")));
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

const PAGE = "https://agent.example";

function preflight(url: string, origin = PAGE): Promise<Response> {
  return fetch(url, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-api-key, anthropic-version, content-type, anthropic-dangerous-direct-browser-access",
    },
  });
}

describe("isModelApiPath", () => {
  test("covers vendor routes, not console or cookie APIs", () => {
    for (const p of ["/v1", "/v1/messages", "/messages", "/messages/count_tokens", "/chat/completions", "/responses", "/responses/r1", "/models", "/models/x", "/v1/v1/models"]) {
      expect(isModelApiPath(p)).toBe(true);
    }
    for (const p of ["/", "/console", "/api/me", "/api/auth/login", "/health", "/hooks/wechat", "/v1x", "/modelsx"]) {
      expect(isModelApiPath(p)).toBe(false);
    }
  });

  test("empty list or * means any origin", () => {
    expect(corsOrigin([])).toBe("*");
    expect(corsOrigin(["https://a.example", "*"])).toBe("*");
    expect(corsOrigin(["https://a.example"])).toEqual(["https://a.example"]);
  });
});

describe("CORS over HTTP", () => {
  test("disabled by default: no CORS headers", async () => {
    await withSrv(() => undefined, async (url) => {
      const res = await preflight(`${url}/v1/messages`);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const models = await fetch(`${url}/v1/models`, { headers: { origin: PAGE, "x-api-key": "sk-carbon-local" } });
      expect(models.status).toBe(200);
      expect(models.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  test("enabled: preflight reflects SDK headers on model routes only", async () => {
    await withSrv((c) => {
      c.cors.enabled = true;
    }, async (url) => {
      const res = await preflight(`${url}/v1/messages`);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-headers")).toContain("anthropic-dangerous-direct-browser-access");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(res.headers.get("access-control-max-age")).toBe("86400");

      const cookieApi = await preflight(`${url}/api/me`);
      expect(cookieApi.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  test("enabled: 401 is readable cross-origin", async () => {
    await withSrv((c) => {
      c.cors.enabled = true;
    }, async (url) => {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { origin: PAGE, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  test("enabled: SSE keeps CORS and event-stream headers", async () => {
    await withSrv((c) => {
      c.cors.enabled = true;
    }, async (url) => {
      const sse = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: {
          origin: PAGE,
          "content-type": "application/json",
          "x-api-key": "sk-carbon-local",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: "claude-opus-5", max_tokens: 16, stream: true, messages: [{ role: "user", content: "hi" }] }),
      });
      expect(isSseContentType(sse.headers.get("content-type"))).toBe(true);
      expect(sse.headers.get("access-control-allow-origin")).toBe("*");
      expect(sse.headers.get("x-accel-buffering")).toBe("no");

      const jobs = (await (await fetch(`${url}/debug/jobs`)).json()) as { jobs: { id: string }[] };
      const id = jobs.jobs[0]?.id;
      expect(id).toBeTruthy();
      await fetch(`${url}/debug/jobs/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "pong" }),
      });
      const body = await sse.text();
      expect(body).toContain("pong");
      expect(body).toContain("event: message_stop");
    });
  });

  test("allowlist echoes listed origins and varies on Origin", async () => {
    await withSrv((c) => {
      c.cors.enabled = true;
      c.cors.origins = [PAGE];
    }, async (url) => {
      const ok = await fetch(`${url}/v1/models`, { headers: { origin: PAGE, "x-api-key": "sk-carbon-local" } });
      expect(ok.headers.get("access-control-allow-origin")).toBe(PAGE);
      expect(ok.headers.get("vary") ?? "").toContain("Origin");

      const other = await preflight(`${url}/v1/models`, "https://other.example");
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
