const encoder = new TextEncoder();

export class SseWriter {
  private chain: Promise<void> = Promise.resolve();
  private failed: Error | null = null;
  bytesWritten = 0;

  constructor(private readonly writeBytes: (bytes: Uint8Array) => Promise<void>) {}

  private enqueue(bytes: Uint8Array): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.failed) throw this.failed;
      try {
        await this.writeBytes(bytes);
        this.bytesWritten += bytes.byteLength;
      } catch (err) {
        this.failed = err instanceof Error ? err : new Error(String(err));
        throw this.failed;
      }
    });
    return this.chain;
  }

  comment(s: string): Promise<void> {
    return this.enqueue(encoder.encode(`: ${s}\n\n`));
  }

  data(payload: string): Promise<void> {
    return this.enqueue(encoder.encode(`data: ${payload}\n\n`));
  }

  event(name: string, payload: unknown): Promise<void> {
    if (payload !== null && typeof payload === "object" && "type" in payload) {
      const type = (payload as { type: unknown }).type;
      if (type !== name) {
        throw new Error(`SseWriter.event: event name "${name}" !== payload.type "${String(type)}"`);
      }
    }
    const json = JSON.stringify(payload);
    return this.enqueue(encoder.encode(`event: ${name}\ndata: ${json}\n\n`));
  }

  drain(): Promise<void> {
    return this.chain;
  }
}
