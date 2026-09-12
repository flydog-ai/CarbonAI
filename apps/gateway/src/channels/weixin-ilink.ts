/**
 * Tencent iLink bot HTTP JSON API, as documented for third-party backends:
 * https://docs.openclaw.ai/zh-CN/channels/wechat
 * (plugin README: 二次开发者若需对接自有后端)
 *
 * iLink-App-Id "bot" is the protocol id Tencent publishes on the MIT plugin
 * (@tencent-weixin/openclaw-weixin). bot_agent identifies this gateway.
 */
import { randomBytes } from "node:crypto";

export const ILINK_QR_BASE = "https://ilinkai.weixin.qq.com";
export const ILINK_BOT_TYPE = "3";
export const ILINK_APP_ID = "bot";
const ILINK_CLIENT_VERSION = String(((1 & 0xff) << 16) | ((0 & 0xff) << 8) | (0 & 0xff));
const BOT_AGENT = "CarbonAI/1.0";

export type IlinkFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type IlinkMessage = {
  from_user_id?: string;
  to_user_id?: string;
  message_type?: number;
  context_token?: string;
  item_list?: { type?: number; text_item?: { text?: string } }[];
};

export type QrStart = { qrcode: string; qrcodeUrl: string };
export type QrStatus = {
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
};

function uin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64");
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_CLIENT_VERSION,
  };
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin(),
    ...commonHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} invalid json`);
  }
}

export async function fetchBotQr(fetchImpl: IlinkFetch, baseUrl = ILINK_QR_BASE): Promise<QrStart> {
  const url = `${baseUrl.replace(/\/$/, "")}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...commonHeaders() },
    body: JSON.stringify({ local_token_list: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await readJson(res, "get_bot_qrcode")) as { qrcode?: string; qrcode_img_content?: string };
  if (!body.qrcode || !body.qrcode_img_content) throw new Error("get_bot_qrcode missing qrcode");
  return { qrcode: body.qrcode, qrcodeUrl: body.qrcode_img_content };
}

export async function pollQrStatus(
  fetchImpl: IlinkFetch,
  qrcode: string,
  opts: { baseUrl?: string; verifyCode?: string } = {},
): Promise<QrStatus> {
  const base = (opts.baseUrl ?? ILINK_QR_BASE).replace(/\/$/, "");
  let path = `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (opts.verifyCode) path += `&verify_code=${encodeURIComponent(opts.verifyCode)}`;
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method: "GET",
      headers: commonHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    return (await readJson(res, "get_qrcode_status")) as QrStatus;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return { status: "wait" };
    }
    throw err;
  }
}

function withBaseInfo(body: Record<string, unknown>): string {
  return JSON.stringify({
    ...body,
    base_info: { channel_version: "1.0.0", bot_agent: BOT_AGENT },
  });
}

export async function ilinkPost(
  fetchImpl: IlinkFetch,
  opts: { baseUrl: string; token: string; path: string; body: Record<string, unknown>; timeoutMs?: number; abort?: AbortSignal },
): Promise<unknown> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/${opts.path.replace(/^\//, "")}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: authHeaders(opts.token),
    body: withBaseInfo(opts.body),
    signal: opts.abort ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  return readJson(res, opts.path);
}

export async function getUpdates(
  fetchImpl: IlinkFetch,
  opts: { baseUrl: string; token: string; buf: string; timeoutMs?: number; abort?: AbortSignal },
): Promise<{ ret?: number; errcode?: number; errmsg?: string; msgs?: IlinkMessage[]; get_updates_buf?: string; longpolling_timeout_ms?: number }> {
  const timeout = opts.timeoutMs ?? 35_000;
  try {
    return (await ilinkPost(fetchImpl, {
      baseUrl: opts.baseUrl,
      token: opts.token,
      path: "ilink/bot/getupdates",
      body: { get_updates_buf: opts.buf },
      timeoutMs: timeout,
      abort: opts.abort,
    })) as Awaited<ReturnType<typeof getUpdates>>;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return { ret: 0, msgs: [], get_updates_buf: opts.buf };
    }
    throw err;
  }
}

export async function sendBotText(
  fetchImpl: IlinkFetch,
  opts: { baseUrl: string; token: string; toUserId: string; text: string; contextToken?: string },
): Promise<void> {
  const resp = (await ilinkPost(fetchImpl, {
    baseUrl: opts.baseUrl,
    token: opts.token,
    path: "ilink/bot/sendmessage",
    body: {
      msg: {
        from_user_id: "",
        to_user_id: opts.toUserId,
        client_id: `carbon-${Date.now()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: opts.text } }],
        context_token: opts.contextToken,
      },
    },
  })) as { ret?: number; errmsg?: string };
  if (resp.ret && resp.ret !== 0) throw new Error(`sendmessage ret=${resp.ret} ${resp.errmsg ?? ""}`);
}

export function textFromIlink(msg: IlinkMessage): string {
  const items = msg.item_list ?? [];
  return items
    .filter((i) => i.type === 1)
    .map((i) => i.text_item?.text ?? "")
    .join("\n")
    .trim();
}
