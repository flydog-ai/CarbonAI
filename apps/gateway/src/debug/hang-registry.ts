import type { AbortVia } from "../http/sse-pipe.ts";

export type HangStatus = "streaming" | "completed" | "cancelled";

export type HangSession = {
  id: string;
  status: HangStatus;
  abortVia: AbortVia[];
  bytesWritten: number;
  startedAt: number;
  endedAt?: number;
};

export class HangRegistry {
  private readonly sessions = new Map<string, HangSession>();

  create(id: string): HangSession {
    const session: HangSession = {
      id,
      status: "streaming",
      abortVia: [],
      bytesWritten: 0,
      startedAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): HangSession | undefined {
    return this.sessions.get(id);
  }

  markCancelled(id: string, via: AbortVia): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (!session.abortVia.includes(via)) session.abortVia.push(via);
    if (session.status === "streaming") {
      session.status = "cancelled";
      session.endedAt = Date.now();
    }
  }

  markCompleted(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.status !== "streaming") return;
    session.status = "completed";
    session.endedAt = Date.now();
  }

  setBytes(id: string, n: number): void {
    const session = this.sessions.get(id);
    if (session) session.bytesWritten = n;
  }
}

export function parseHangSeconds(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 60;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3600) {
    throw new Error("seconds must be an integer 1..3600");
  }
  return n;
}
