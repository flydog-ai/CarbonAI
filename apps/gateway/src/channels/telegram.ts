export type TgFetch = (url: string, init?: RequestInit) => Promise<Response>;

type TgUpdate = {
  update_id: number;
  message?: { chat?: { id?: number }; from?: { id?: number }; text?: string };
};

export async function telegramSend(
  fetchImpl: TgFetch,
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { ok?: boolean; description?: string };
  if (!body.ok) throw new Error(body.description || `telegram send ${res.status}`);
}

export async function telegramLoop(
  fetchImpl: TgFetch,
  opts: {
    token: string;
    abort: AbortSignal;
    onText: (peerId: string, text: string) => Promise<string | undefined>;
  },
): Promise<void> {
  let offset = 0;
  while (!opts.abort.aborted) {
    try {
      const url = `https://api.telegram.org/bot${opts.token}/getUpdates?timeout=25&offset=${offset}`;
      const res = await fetchImpl(url, { signal: opts.abort });
      const body = (await res.json()) as { ok?: boolean; result?: TgUpdate[] };
      if (!body.ok) {
        await Bun.sleep(2000);
        continue;
      }
      for (const u of body.result ?? []) {
        offset = u.update_id + 1;
        const text = u.message?.text?.trim();
        const peer = String(u.message?.from?.id ?? u.message?.chat?.id ?? "");
        if (!text || !peer) continue;
        const reply = await opts.onText(peer, text);
        if (reply) {
          try {
            await telegramSend(fetchImpl, opts.token, peer, reply);
          } catch {
            /* next update still works */
          }
        }
      }
    } catch {
      if (opts.abort.aborted) return;
      await Bun.sleep(2000);
    }
  }
}
