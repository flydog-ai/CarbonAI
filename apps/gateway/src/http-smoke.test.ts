import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "@carbon-ai/config";
import { createApp } from "./app.ts";
import { HangRegistry } from "./debug/hang-registry.ts";
import { isSseContentType } from "./http/sse-headers.ts";
import { listen, type ListenHandle } from "./listen.ts";

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

async function start(opts: { idleTimeout?: number } = {}): Promise<{
  port: number;
  url4: string;
  url6: string;
  sessions: HangRegistry;
  handle: ListenHandle;
}> {
  let lastErr: unknown;
  for (let i = 0; i < 8; i++) {
    const port = pickPort();
    const sessions = new HangRegistry();
    const app = createApp(DEFAULT_CONFIG, { sessions });
    try {
      const handle = listen(app.fetch, {
        host: "loopback",
        port,
        idleTimeout: opts.idleTimeout ?? 0,
        maxRequestBodySize: 16 * 1024 * 1024,
      });
      return {
        port: handle.port,
        url4: `http://127.0.0.1:${handle.port}`,
        url6: `http://[::1]:${handle.port}`,
        sessions,
        handle,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("could not bind test port");
}

async function readUntil(
  res: Response,
  predicate: (buf: string) => boolean,
  timeoutMs: number,
): Promise<{ buf: string; firstByteMs: number; ended: boolean; sawPredicateBeforeEnd: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  const t0 = performance.now();
  let firstByteMs: number | undefined;
  let sawPredicateBeforeEnd = false;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ done: true, timedOut: true }), remaining),
        ),
      ]);
      if ("timedOut" in result) {
        break;
      }
      if (result.value) {
        if (firstByteMs === undefined) firstByteMs = performance.now() - t0;
        buf += dec.decode(result.value, { stream: true });
        if (predicate(buf)) sawPredicateBeforeEnd = true;
      }
      if (result.done) {
        return {
          buf,
          firstByteMs: firstByteMs ?? performance.now() - t0,
          ended: true,
          sawPredicateBeforeEnd,
        };
      }
      if (sawPredicateBeforeEnd) break;
    }
    return {
      buf,
      firstByteMs: firstByteMs ?? timeoutMs,
      ended: false,
      sawPredicateBeforeEnd,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

let running: ListenHandle | undefined;

afterEach(() => {
  running?.stop();
  running = undefined;
});

describe("HTTP smoke (real listen)", () => {
  test("dual-stack /health and /ready", async () => {
    const srv = await start();
    running = srv.handle;
    const h4 = await fetch(`${srv.url4}/health`);
    const h6 = await fetch(`${srv.url6}/health`);
    expect(h4.status).toBe(200);
    expect(h6.status).toBe(200);
    expect(await h4.json()).toEqual({ ok: true, name: "carbon-ai" });
    expect(await h6.json()).toEqual({ ok: true, name: "carbon-ai" });
    const ready = await fetch(`${srv.url4}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true });
  });

  test("GET / is homepage with CC Switch import into Claude Code", async () => {
    const srv = await start();
    running = srv.handle;
    const res = await fetch(`${srv.url4}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html).toContain("ccswitch://v1/import?");
    expect(html).toContain("app=claude");
    expect(html).toContain("导入到 Claude Code");
    expect(html).toContain("id=\"cc-switch-import\"");
    expect(html).toContain(encodeURIComponent(srv.url4));
    expect(html).toContain("apiKey=");
    expect(html).toContain("sk-carbon-local");
    expect(html).not.toContain(encodeURIComponent(`${srv.url4}/v1`));
  });

  test("HEAD and GET /api/hello are 200 empty", async () => {
    const srv = await start();
    running = srv.handle;
    const head = await fetch(`${srv.url4}/api/hello`, { method: "HEAD" });
    const get = await fetch(`${srv.url4}/api/hello`);
    expect(head.status).toBe(200);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("");
  });

  test("SSE headers, first byte < 2s, last frame before body end", async () => {
    const srv = await start();
    running = srv.handle;
    const id = crypto.randomUUID();
    const t0 = performance.now();
    const res = await fetch(`${srv.url4}/debug/sse-hang?seconds=2&id=${id}`);
    expect(isSseContentType(res.headers.get("content-type"))).toBe(true);
    expect(res.headers.get("cache-control") ?? "").toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")?.toLowerCase()).toBe("no");
    expect(res.headers.get("content-encoding")?.toLowerCase() === "gzip").toBe(false);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    let firstByteMs: number | undefined;
    let sawDone = false;
    let sawDoneBeforeEnd = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs === undefined) firstByteMs = performance.now() - t0;
      buf += dec.decode(value, { stream: true });
      if (buf.includes('"done":true')) {
        sawDone = true;
        sawDoneBeforeEnd = true;
      }
    }
    expect(firstByteMs).toBeLessThan(2000);
    expect(sawDone).toBe(true);
    expect(sawDoneBeforeEnd).toBe(true);
    expect(buf).toContain(": ping");
    expect(buf).toContain('"t":0');
    const status = await fetch(`${srv.url4}/debug/sse-status?id=${id}`).then((r) => r.json());
    expect(status.status).toBe("completed");
  });

  test("client abort marks hang cancelled within 2s (runtime go/no-go)", async () => {
    const srv = await start();
    running = srv.handle;
    const id = crypto.randomUUID();
    const ac = new AbortController();
    const res = await fetch(`${srv.url4}/debug/sse-hang?seconds=30&id=${id}`, { signal: ac.signal });
    expect(isSseContentType(res.headers.get("content-type"))).toBe(true);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const first = await reader.read();
    expect(first.done).toBe(false);
    ac.abort();
    try {
      await reader.cancel();
    } catch {
      // ignore
    }

    const deadline = Date.now() + 2000;
    let session: { status: string; abortVia: string[] } | undefined;
    while (Date.now() < deadline) {
      const r = await fetch(`${srv.url4}/debug/sse-status?id=${id}`);
      session = (await r.json()) as { status: string; abortVia: string[] };
      if (session.status === "cancelled") break;
      await Bun.sleep(50);
    }
    expect(session?.status).toBe("cancelled");
    expect((session?.abortVia ?? []).length).toBeGreaterThan(0);
  });

  test("SSE hang survives past Bun default idleTimeout (10s)", async () => {
    const srv = await start({ idleTimeout: 0 });
    running = srv.handle;
    const id = crypto.randomUUID();
    const res = await fetch(`${srv.url4}/debug/sse-hang?seconds=12&id=${id}`);
    const got = await readUntil(res, (buf) => buf.includes('"t":11'), 14_000);
    expect(got.sawPredicateBeforeEnd).toBe(true);
    expect(got.ended).toBe(false);
  }, 20_000);
});
