import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { openaiError } from "@carbon-ai/protocol";
import { accessLog } from "./access-log.ts";

describe("accessLog", () => {
  test("logs inbound and 404 for OpenAI path missing /v1", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", accessLog({ write: (s) => lines.push(s) }));
    app.notFound((c) => c.json(openaiError(`Unknown request URL: ${c.req.path}`), 404));
    const res = await app.request("http://127.0.0.1:12580/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sk-test",
        "user-agent": "OpenAI/Python 1.40.0",
      },
    });
    expect(res.status).toBe(404);
    expect(lines[0]).toContain("http ← POST /chat/completions");
    expect(lines[0]).toContain("auth=bearer");
    expect(lines[0]).toContain("OpenAI/Python");
    expect(lines[1]).toContain("http → POST /chat/completions 404");
    expect(lines[1]).toContain("Unknown request URL: /chat/completions");
  });

  test("logs POST even when the path is not under /v1", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", accessLog({ write: (s) => lines.push(s) }));
    app.post("/weird", (c) => c.json({ ok: true }, 200));
    await app.request("http://127.0.0.1:12580/weird", { method: "POST" });
    expect(lines[0]).toContain("http ← POST /weird");
    expect(lines[1]).toContain("http → POST /weird 200");
  });

  test("skips console and health noise", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use("*", accessLog({ write: (s) => lines.push(s) }));
    app.get("/health", (c) => c.json({ ok: true }));
    await app.request("http://127.0.0.1:12580/health");
    expect(lines).toEqual([]);
  });
});
