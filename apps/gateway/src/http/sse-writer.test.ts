import { describe, expect, test } from "bun:test";
import { SseWriter } from "./sse-writer.ts";

describe("SseWriter", () => {
  test("comment, data, event framing and drain", async () => {
    const chunks: Uint8Array[] = [];
    const writer = new SseWriter(async (bytes) => {
      chunks.push(bytes);
    });
    await writer.comment("ping");
    await writer.data('{"t":1}');
    await writer.event("keepalive", { type: "keepalive", sequence_number: 3 });
    await writer.drain();
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toBe(
      ': ping\n\ndata: {"t":1}\n\nevent: keepalive\ndata: {"type":"keepalive","sequence_number":3}\n\n',
    );
    expect(writer.bytesWritten).toBe(Buffer.byteLength(text));
  });

  test("event name must match payload.type", async () => {
    const writer = new SseWriter(async () => {});
    expect(() => writer.event("ping", { type: "keepalive" })).toThrow(/payload.type/);
  });

  test("CJK and emoji stay intact (no UTF-16 slice)", async () => {
    const chunks: Uint8Array[] = [];
    const writer = new SseWriter(async (bytes) => {
      chunks.push(bytes);
    });
    await writer.data(JSON.stringify({ text: "你好😀" }));
    await writer.drain();
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("你好😀");
    expect(JSON.parse(text.replace(/^data: /, "").trim())).toEqual({ text: "你好😀" });
  });
});
