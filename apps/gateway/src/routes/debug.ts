import { Hono } from "hono";
import { HangRegistry, parseHangSeconds } from "../debug/hang-registry.ts";
import { interruptibleSleep, openSse } from "../http/sse-pipe.ts";

export function debugRoutes(sessions: HangRegistry): Hono {
  const app = new Hono();

  app.get("/debug/sse-status", (c) => {
    const id = c.req.query("id");
    if (!id) return c.json({ error: "missing id" }, 400);
    const session = sessions.get(id);
    if (!session) return c.json({ error: "unknown id" }, 404);
    return c.json(session);
  });

  app.get("/debug/sse-hang", (c) => {
    let seconds: number;
    try {
      seconds = parseHangSeconds(c.req.query("seconds"));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "bad seconds" }, 400);
    }
    const id = c.req.query("id") || crypto.randomUUID();
    sessions.create(id);

    return openSse(c, {
      onAbort: (via) => sessions.markCancelled(id, via),
      run: async (writer, ctl) => {
        const flushBytes = (): void => sessions.setBytes(id, writer.bytesWritten);

        await writer.data(JSON.stringify({ id, t: 0 }));
        flushBytes();
        for (let t = 1; t <= seconds; t++) {
          await interruptibleSleep(1000, ctl.shouldStop);
          if (ctl.shouldStop()) return;
          await writer.comment("ping");
          await writer.data(JSON.stringify({ id, t }));
          flushBytes();
        }
        if (ctl.shouldStop()) return;
        await writer.data(JSON.stringify({ id, done: true }));
        await writer.drain();
        flushBytes();
        sessions.markCompleted(id);
      },
    });
  });

  return app;
}
