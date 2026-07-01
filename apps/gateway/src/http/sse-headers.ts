import type { Context } from "hono";

/** Must be applied on `c` BEFORE `return stream(...)`. Hono `stream()` does not set these. */
export function setSseHeaders(c: Context): void {
  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
}

export function isSseContentType(value: string | null): boolean {
  return (value ?? "").toLowerCase().startsWith("text/event-stream");
}
