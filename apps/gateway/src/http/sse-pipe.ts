import type { Context } from "hono";
import { stream } from "hono/streaming";
import { setSseHeaders } from "./sse-headers.ts";
import { SseWriter } from "./sse-writer.ts";

export type AbortVia = "signal" | "onAbort" | "write_fail";

export type SseControl = {
  shouldStop: () => boolean;
  abortVias: () => readonly AbortVia[];
};

export type OpenSseOptions = {
  onAbort?: (via: AbortVia) => void;
  run: (writer: SseWriter, ctl: SseControl) => Promise<void>;
};

/**
 * Open an SSE response. Sets the four SSE headers on `c` BEFORE creating the stream.
 * The callback must not return until the session is terminal (caller awaits work).
 *
 * Abort is observed on three channels (any one is enough):
 * 1. `c.req.raw.signal`
 * 2. Hono `stream.onAbort`
 * 3. `writeBytes` throwing
 */
export function openSse(c: Context, opts: OpenSseOptions): Response {
  setSseHeaders(c);
  return stream(c, async (s) => {
    const vias: AbortVia[] = [];
    let aborted = false;

    const fire = (via: AbortVia): void => {
      if (!vias.includes(via)) vias.push(via);
      if (aborted) return;
      aborted = true;
      opts.onAbort?.(via);
    };

    s.onAbort(() => fire("onAbort"));
    const signal = c.req.raw.signal;
    const onSignal = (): void => fire("signal");
    signal.addEventListener("abort", onSignal);

    const writer = new SseWriter(async (bytes) => {
      try {
        await s.write(bytes);
      } catch (err) {
        fire("write_fail");
        throw err;
      }
    });

    const ctl: SseControl = {
      shouldStop: () => aborted,
      abortVias: () => vias,
    };

    try {
      await opts.run(writer, ctl);
      await writer.drain();
    } catch (err) {
      fire("write_fail");
      if (!ctl.shouldStop()) throw err;
    } finally {
      signal.removeEventListener("abort", onSignal);
    }
  });
}

export function interruptibleSleep(ms: number, shouldStop: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (shouldStop()) {
      resolve();
      return;
    }
    const started = Date.now();
    const tick = (): void => {
      if (shouldStop() || Date.now() - started >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(50, ms));
    };
    setTimeout(tick, Math.min(50, ms));
  });
}
