import { BodyTooLargeError } from "../job/errors.ts";

export async function readBytesCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const n = Number(lenHeader);
    if (Number.isFinite(n) && n > maxBytes) throw new BodyTooLargeError(maxBytes);
  }
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBytesCapped(req, maxBytes);
  if (bytes.byteLength === 0) return {};
  return JSON.parse(new TextDecoder().decode(bytes));
}
