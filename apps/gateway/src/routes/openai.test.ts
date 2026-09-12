import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Config } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { isSseContentType } from "../http/sse-headers.ts";
import { listen } from "../listen.ts";
import { JobEngine } from "../job/engine.ts";
import { createApp } from "../app.ts";
import type { AssistantBlock } from "@carbon-ai/protocol";

function pickPort(): number {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ok"),
  });
  const port = probe.port;
  probe.stop(true);
  return port;
}

async function withSrv(
  fn: (url: string, engine: JobEngine) => Promise<void>,
  over: (c: Config) => void = () => undefined,
): Promise<void> {
  const conf = structuredClone(DEFAULT_CONFIG);
  over(conf);
  const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-oai-")));
  const engine = new JobEngine(conf, db);
  const app = createApp(conf, { engine });
  const handle = listen(app.fetch, { host: "127.0.0.1", port: pickPort(), idleTimeout: 0 });
  try {
    await fn(`http://127.0.0.1:${handle.port}`, engine);
  } finally {
    handle.stop();
    engine.stop();
    db.close();
  }
}

const headers = {
  "content-type": "application/json",
  authorization: "Bearer sk-carbon-local",
};

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf;
}

async function latestJobId(url: string): Promise<string> {
  const jobs = (await (await fetch(`${url}/debug/jobs`)).json()) as { jobs: { id: string }[] };
  const id = jobs.jobs[0]?.id;
  if (!id) throw new Error("no job");
  return id;
}

async function complete(url: string, id: string, body: { text?: string; blocks?: AssistantBlock[] }): Promise<Response> {
  return fetch(`${url}/debug/jobs/${id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("OpenAI Chat Completions HTTP", () => {
  test("401 without bearer", async () => {
    await withSrv(
      async (url) => {
        const res = await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] }),
        });
        expect(res.status).toBe(401);
        const json = (await res.json()) as { error: { code: string } };
        expect(json.error.code).toBe("invalid_api_key");
      },
      (c) => {
        c.auth.apiKeys = [{ label: "local", key: "sk-carbon-local" }];
      },
    );
  });

  test("OpenAI JSON on POST /v1/messages is answered as chat.completion", async () => {
    await withSrv(async (url) => {
      const wait = fetch(`${url}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] }),
      });
      await Bun.sleep(30);
      const id = await latestJobId(url);
      await complete(url, id, { text: "pong" });
      const res = await wait;
      expect(res.status).toBe(200);
      const json = (await res.json()) as { object: string; choices: { message: { content: string } }[] };
      expect(json.object).toBe("chat.completion");
      expect(json.choices[0]?.message.content).toBe("pong");
    });
  });

  test("x-api-key and Bearer accept the same secret", async () => {
    await withSrv(
      async (url) => {
        const bearer = await fetch(`${url}/v1/models`, { headers: { authorization: "Bearer sk-carbon-local" } });
        const x = await fetch(`${url}/v1/models`, { headers: { "x-api-key": "sk-carbon-local" } });
        expect(bearer.status).toBe(200);
        expect(x.status).toBe(200);
        const body = (await x.json()) as { data: { id: string }[] };
        const ids = body.data.map((m) => m.id);
        expect(ids[0]).toBe("gpt-5");
        expect(ids.indexOf("gpt-5")).toBeLessThan(ids.indexOf("claude-fable-5-1"));
      },
      (c) => {
        c.auth.apiKeys = [{ label: "local", key: "sk-carbon-local" }];
      },
    );
  });

  test("POST /chat/completions without /v1 is the same handler, not 404", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { param: string } };
      expect(json.error.param).toBe("messages");
    });
  });

  test("400 when messages missing", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { param: string } };
      expect(json.error.param).toBe("messages");
    });
  });

  test("stream hangs with role-only first chunk then [DONE]; no event: lines", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(isSseContentType(sse.headers.get("content-type"))).toBe(true);
      const id = await latestJobId(url);
      const done = complete(url, id, { text: "pong 你好😀" });
      const buf = await readBody(sse);
      expect(buf.includes("event:")).toBe(false);
      expect(buf).toContain("data: [DONE]");
      expect(buf).toContain("pong 你好😀");
      expect(buf).toContain('"role":"assistant"');
      expect(buf).not.toContain('"role":"assistant","content"');
      expect((await done).status).toBe(200);
    });
  });

  test("non-stream JSON after complete; tool-only content null", async () => {
    await withSrv(async (url) => {
      const wait = fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          messages: [{ role: "user", content: "run" }],
          tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        }),
      });
      await Bun.sleep(30);
      const id = await latestJobId(url);
      await complete(url, id, {
        blocks: [
          {
            type: "tool_use",
            kind: "openai_function",
            id: "call_1",
            callId: "call_1",
            name: "lookup",
            payload: { form: "json", value: { q: 1 } },
          },
        ],
      });
      const res = await wait;
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        object: string;
        choices: { message: { content: unknown; tool_calls: unknown[] }; finish_reason: string }[];
      };
      expect(json.object).toBe("chat.completion");
      expect(json.choices[0]?.message.content).toBeNull();
      expect(json.choices[0]?.finish_reason).toBe("tool_calls");
      expect(json.choices[0]?.message.tool_calls).toHaveLength(1);
    });
  });

  test("include_usage stream ends with usage chunk then [DONE]", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          stream: true,
          stream_options: { include_usage: true },
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const id = await latestJobId(url);
      const done = complete(url, id, { text: "ok" });
      const buf = await readBody(sse);
      expect(buf).toContain('"usage":null');
      expect(buf).toContain('"choices":[]');
      expect(buf).toContain("prompt_tokens");
      expect(buf.trim().endsWith("data: [DONE]")).toBe(true);
      expect((await done).status).toBe(200);
    });
  });

  test("midstream error has no [DONE]", async () => {
    await withSrv(async (url, engine) => {
      const sse = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const id = await latestJobId(url);
      await Bun.sleep(40);
      await engine.fail(id, { code: "timeout", message: "Carbon AI operator wait timeout" });
      const buf = await readBody(sse);
      expect(buf).toContain('"code":"timeout"');
      expect(buf).not.toContain("data: [DONE]");
    });
  });
});

describe("OpenAI Responses HTTP", () => {
  test("400 without input and previous_response_id", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { param: string } };
      expect(json.error.param).toBe("input");
    });
  });

  test("stream: created, in_progress, completed, [DONE]; event name = type", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5", stream: true, input: "hi", store: false }),
      });
      expect(isSseContentType(sse.headers.get("content-type"))).toBe(true);
      const id = await latestJobId(url);
      const done = complete(url, id, { text: "pong 你好😀" });
      const buf = await readBody(sse);
      expect(buf).toContain("event: response.created");
      expect(buf).toContain("event: response.in_progress");
      expect(buf).toContain("event: response.completed");
      expect(buf).toContain("data: [DONE]");
      expect(buf).toContain("pong 你好😀");
      expect(buf).toContain('"store":false');
      expect(buf).toContain('"sequence_number":0');
      expect(buf).toContain('"sequence_number":1');
      expect((await done).status).toBe(200);
    });
  });

  test("GET /v1/responses/:id after complete; DELETE is soft; cancel is 409", async () => {
    await withSrv(async (url) => {
      const wait = fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5", input: "hi" }),
      });
      await Bun.sleep(30);
      const jobId = await latestJobId(url);
      await complete(url, jobId, { text: "later" });
      const created = await wait;
      expect(created.status).toBe(200);
      const body = (await created.json()) as { id: string; status: string; output: unknown[] };
      expect(body.status).toBe("completed");
      expect(body.id.startsWith("resp_")).toBe(true);

      const got = await fetch(`${url}/v1/responses/${body.id}`, { headers });
      expect(got.status).toBe(200);
      const again = (await got.json()) as { id: string; status: string };
      expect(again.id).toBe(body.id);
      expect(again.status).toBe("completed");

      const cancel = await fetch(`${url}/v1/responses/${body.id}/cancel`, { method: "POST", headers });
      expect(cancel.status).toBe(409);
      const cancelJson = (await cancel.json()) as { error: { message: string } };
      expect(cancelJson.error.message).toBe("background responses not supported");

      const del = await fetch(`${url}/v1/responses/${body.id}`, { method: "DELETE", headers });
      expect(del.status).toBe(200);
      const delJson = (await del.json()) as { deleted: boolean };
      expect(delJson.deleted).toBe(true);

      const missing = await fetch(`${url}/v1/responses/${body.id}`, { headers });
      expect(missing.status).toBe(404);
    });
  });

  test("GET in-progress then previous_response_id on a follow-up", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5", stream: true, input: "first turn" }),
      });
      const reader = sse.body?.getReader();
      if (!reader) throw new Error("no body");
      const dec = new TextDecoder();
      let head = "";
      while (!head.includes("response.created")) {
        const { done, value } = await reader.read();
        if (done) break;
        head += dec.decode(value, { stream: true });
      }
      const match = /"id":"(resp_[^"]+)"/.exec(head);
      const vendorId = match?.[1];
      expect(vendorId).toBeTruthy();
      const live = await fetch(`${url}/v1/responses/${vendorId}`, { headers });
      expect(live.status).toBe(200);
      const liveJson = (await live.json()) as { status: string; output: unknown[] };
      expect(liveJson.status).toBe("in_progress");
      expect(liveJson.output).toEqual([]);

      const jobId = await latestJobId(url);
      await complete(url, jobId, { text: "first reply" });
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const follow = fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          input: "second turn",
          previous_response_id: vendorId,
        }),
      });
      await Bun.sleep(30);
      const followId = await latestJobId(url);
      await complete(url, followId, { text: "second reply" });
      const followBody = (await (await follow).json()) as { previous_response_id: string; status: string };
      expect(followBody.previous_response_id).toBe(vendorId);
      expect(followBody.status).toBe("completed");
    });
  });

  test("previous_response_id unknown is 400 with param", async () => {
    await withSrv(async (url) => {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "gpt-5", previous_response_id: "resp_missing" }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { param: string } };
      expect(json.error.param).toBe("previous_response_id");
    });
  });

  test("function_call stream uses tools[] kind; local_shell includes env", async () => {
    await withSrv(async (url) => {
      const sse = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5",
          stream: true,
          input: "shell",
          tools: [{ type: "local_shell" }],
        }),
      });
      const id = await latestJobId(url);
      const done = complete(url, id, {
        blocks: [
          {
            type: "tool_use",
            kind: "local_shell",
            id: "lsc_1",
            callId: "call_1",
            payload: { form: "local_shell", action: { type: "exec", command: ["ls"], env: {} } },
          },
        ],
      });
      const buf = await readBody(sse);
      expect(buf).toContain("local_shell_call");
      expect(buf).toContain('"env":{}');
      expect(buf).not.toContain('"type":"function_call"');
      expect((await done).status).toBe(200);
    });
  });
});
