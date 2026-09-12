import { createHmac, timingSafeEqual } from "node:crypto";

export type FsFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function feishuChallenge(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as { type?: string; challenge?: string };
  if (rec.type === "url_verification" && rec.challenge) return rec.challenge;
  return undefined;
}

export function feishuText(body: unknown): { peerId: string; text: string } | undefined {
  const rec = body as {
    header?: { event_type?: string };
    event?: {
      sender?: { sender_id?: { open_id?: string } };
      message?: { message_type?: string; content?: string };
    };
  };
  if (rec.header?.event_type !== "im.message.receive_v1") return undefined;
  const peer = rec.event?.sender?.sender_id?.open_id ?? "";
  if (rec.event?.message?.message_type !== "text") return undefined;
  let text = "";
  try {
    text = String((JSON.parse(rec.event.message.content ?? "{}") as { text?: string }).text ?? "").trim();
  } catch {
    return undefined;
  }
  if (!peer || !text) return undefined;
  return { peerId: peer, text };
}

export async function feishuSend(
  fetchImpl: FsFetch,
  opts: { appId: string; appSecret: string; openId: string; text: string },
): Promise<void> {
  const tokenRes = await fetchImpl("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: opts.appId, app_secret: opts.appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = (await tokenRes.json()) as { tenant_access_token?: string; msg?: string };
  if (!tokenBody.tenant_access_token) throw new Error(tokenBody.msg || "feishu token");
  const res = await fetchImpl("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${tokenBody.tenant_access_token}`,
    },
    body: JSON.stringify({ receive_id: opts.openId, msg_type: "text", content: JSON.stringify({ text: opts.text }) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { code?: number; msg?: string };
  if (body.code && body.code !== 0) throw new Error(body.msg || `feishu send ${body.code}`);
}

/** Optional verification token check (query or body token). */
export function feishuTokenOk(expected: string, presented: string | undefined): boolean {
  if (!expected) return true;
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dingtalkSignOk(secret: string, timestamp: string, sign: string): boolean {
  if (!secret || !timestamp || !sign) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(sign);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function dingtalkText(body: unknown): { peerId: string; text: string } | undefined {
  const rec = body as { senderStaffId?: string; senderId?: string; text?: { content?: string }; msgtype?: string };
  const peer = rec.senderStaffId || rec.senderId || "";
  const text = rec.text?.content?.trim() ?? "";
  if (!peer || !text) return undefined;
  return { peerId: peer, text };
}

export async function dingtalkWebhookSend(fetchImpl: FsFetch, webhook: string, text: string): Promise<void> {
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`dingtalk webhook ${res.status}`);
}
