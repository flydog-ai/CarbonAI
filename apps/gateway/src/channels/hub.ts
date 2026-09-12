import type { Config } from "@carbon-ai/config";
import { newBindingId, newChannelId, type CarbonDb } from "@carbon-ai/db";
import { siteOrigin } from "../home/cc-switch.ts";
import type { JobEngine, JobSummary } from "../job/engine.ts";
import {
  decryptWechatMsg,
  encryptWechatMsg,
  parseWechatXml,
  wechatEncryptedEnvelope,
  wechatSignatureOk,
  wechatTextReply,
  xmlField,
  maskPeer,
} from "./wechat-mp.ts";

const KIND = "wechat_mp";
const LIVE = new Set(["pending", "claimed", "streaming"]);
const BIND_TTL_MS = 10 * 60 * 1000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type WxFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ChannelPublic = {
  id: string;
  kind: typeof KIND;
  label: string;
  enabled: boolean;
  appId: string;
  tokenSet: boolean;
  secretSet: boolean;
  aesSet: boolean;
  bound: number;
};

type BindCode = { userId: string; accountId: string; expiresAt: number };

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  let body = "";
  for (let i = 0; i < 5; i++) {
    body = CROCKFORD[n & 31] + body;
    n >>>= 5;
  }
  return `BIND-${body}`;
}

function liveJobs(engine: JobEngine): JobSummary[] {
  return engine.list().filter((j) => LIVE.has(j.status)).sort((a, b) => a.createdAt - b.createdAt);
}

function jobLine(j: JobSummary, i: number): string {
  const who = j.callerLabel || j.clientLabel || "guest";
  const kind = j.clientKind || "";
  const preview = (j.lastUserPreview || "").slice(0, 80);
  return `${i + 1}. ${who}${kind ? ` · ${kind}` : ""}\n${preview || "(no text)"}`;
}

export class ChannelHub {
  private readonly codes = new Map<string, BindCode>();
  private readonly lastJob = new Map<string, string>();
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly cfg: Config,
    private readonly db: CarbonDb,
    private readonly engine: JobEngine,
    private readonly now: () => number = Date.now,
    private readonly wxFetch: WxFetch = fetch,
  ) {}

  callbackInfo(requestUrl: string): { callbackUrl: string; httpsRequired: boolean } {
    const origin = siteOrigin(this.cfg, requestUrl);
    return {
      callbackUrl: `${origin}/hooks/wechat`,
      httpsRequired: !origin.startsWith("https://"),
    };
  }

  publicWechat(): ChannelPublic | null {
    const row = this.db.channels.getByKind(KIND);
    if (!row) return null;
    return {
      id: row.id,
      kind: KIND,
      label: row.label,
      enabled: row.enabled === 1,
      appId: row.app_id,
      tokenSet: Boolean(row.token),
      secretSet: Boolean(row.app_secret),
      aesSet: Boolean(row.aes_key),
      bound: this.db.channels.listBindings(row.id).length,
    };
  }

  upsertWechat(input: {
    label?: string;
    appId?: string;
    appSecret?: string;
    token?: string;
    aesKey?: string | null;
    enabled?: boolean;
  }): ChannelPublic {
    const current = this.db.channels.getByKind(KIND);
    const appId = input.appId !== undefined ? input.appId.trim() : (current?.app_id ?? "");
    const token = input.token !== undefined ? input.token.trim() : (current?.token ?? "");
    const secret =
      input.appSecret !== undefined
        ? input.appSecret.trim() || null
        : (current?.app_secret ?? null);
    const aes =
      input.aesKey !== undefined ? (input.aesKey?.trim() || null) : (current?.aes_key ?? null);
    const enabled = input.enabled === undefined ? (current?.enabled ?? 0) : input.enabled ? 1 : 0;
    const label = (input.label ?? current?.label ?? "WeChat MP").trim() || "WeChat MP";
    this.db.channels.upsertByKind({
      id: current?.id ?? newChannelId(),
      kind: KIND,
      label,
      app_id: appId,
      app_secret: secret,
      token,
      aes_key: aes,
      enabled,
      created_at: current?.created_at ?? this.now(),
    });
    this.accessToken = undefined;
    return this.publicWechat()!;
  }

  mintBindCode(userId: string): { code: string; expiresAt: number } {
    const account = this.db.channels.getByKind(KIND);
    if (!account || account.enabled !== 1 || !account.token) {
      throw new Error("wechat channel is not enabled");
    }
    const code = newCode();
    const expiresAt = this.now() + BIND_TTL_MS;
    this.codes.set(code, { userId, accountId: account.id, expiresAt });
    return { code, expiresAt };
  }

  bindingFor(userId: string): { bound: boolean; peerMasked?: string } {
    const account = this.db.channels.getByKind(KIND);
    if (!account) return { bound: false };
    const row = this.db.channels.getBindingByUser(account.id, userId);
    if (!row) return { bound: false };
    return { bound: true, peerMasked: maskPeer(row.peer_id) };
  }

  unbind(userId: string): void {
    const account = this.db.channels.getByKind(KIND);
    if (account) this.db.channels.deleteBindingByUser(account.id, userId);
  }

  verifyGet(query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }): string | undefined {
    const account = this.enabledAccount();
    if (!account) return undefined;
    if (
      !wechatSignatureOk(
        account.token,
        query.timestamp ?? "",
        query.nonce ?? "",
        query.signature ?? "",
      )
    ) {
      return undefined;
    }
    return query.echostr ?? "";
  }

  async handlePost(
    query: { signature?: string; timestamp?: string; nonce?: string; msg_signature?: string; encrypt_type?: string },
    rawXml: string,
  ): Promise<string> {
    const account = this.enabledAccount();
    if (!account) return "success";
    let xml = rawXml;
    const encryptType = (query.encrypt_type ?? "").toLowerCase();
    const encrypted = xmlField(rawXml, "Encrypt");
    if (encrypted && (encryptType === "aes" || account.aes_key)) {
      const msgSig = query.msg_signature ?? query.signature ?? "";
      if (!wechatSignatureOk(account.token, query.timestamp ?? "", query.nonce ?? "", msgSig, encrypted)) {
        return "success";
      }
      if (!account.aes_key) return "success";
      xml = decryptWechatMsg(account.aes_key, account.app_id, encrypted);
    } else if (
      !wechatSignatureOk(account.token, query.timestamp ?? "", query.nonce ?? "", query.signature ?? "")
    ) {
      return "success";
    }

    const msg = parseWechatXml(xml);
    const reply = await this.dispatch(account.id, msg);
    if (!reply) return "success";
    const plain = wechatTextReply(msg.toUser, msg.fromUser, reply, this.now());
    if (account.aes_key && (encryptType === "aes" || encrypted)) {
      const nonce = query.nonce || "nonce";
      const timestamp = query.timestamp || String(Math.floor(this.now() / 1000));
      const enc = encryptWechatMsg(account.aes_key, account.app_id, plain);
      return wechatEncryptedEnvelope({ token: account.token, timestamp, nonce, encrypt: enc });
    }
    return plain;
  }

  async notify(job: JobSummary): Promise<void> {
    const account = this.enabledAccount();
    if (!account?.app_id || !account.app_secret) return;
    const bindings = this.db.channels.listBindings(account.id);
    if (bindings.length === 0) return;
    const text = this.notifyText(job);
    for (const b of bindings) {
      this.lastJob.set(b.peer_id, job.id);
      try {
        await this.sendCustom(account.app_id, account.app_secret, b.peer_id, text);
      } catch {
        /* 48h window or network; inbound 列表 still works */
      }
    }
  }

  private notifyText(job: JobSummary): string {
    const origin = this.cfg.site.publicOrigin.trim().replace(/\/$/, "");
    const desk = origin ? `${origin}/console?view=desk` : "/console?view=desk";
    const who = job.callerLabel || job.clientLabel || "guest";
    const kind = job.clientKind ? ` · ${job.clientKind}` : "";
    const preview = (job.lastUserPreview || "").slice(0, 200);
    return `新会话 ${who}${kind}\n${preview || "(no text)"}\n回复这条消息即可作答。多条会话时先发「列表」。\n${desk}`;
  }

  private enabledAccount() {
    const row = this.db.channels.getByKind(KIND);
    if (!row || row.enabled !== 1 || !row.token) return null;
    return row;
  }

  private async dispatch(
    accountId: string,
    msg: { fromUser: string; msgType: string; content: string; event: string },
  ): Promise<string | undefined> {
    if (msg.msgType === "event" && (msg.event === "subscribe" || msg.event === "scan")) {
      return "发送绑定码（控制台 Channels 里复制）以绑定操作者。绑定后新会话会推到这里，直接回复即可。";
    }
    if (msg.msgType !== "text" || !msg.content) return undefined;

    const text = msg.content.trim();
    const bind = /^BIND-([0-9A-HJKMNP-TV-Z]{5})$/i.exec(text);
    if (bind) {
      return this.consumeBind(accountId, msg.fromUser, text.toUpperCase());
    }

    const binding = this.db.channels.getBindingByPeer(accountId, msg.fromUser);
    if (!binding) {
      return "尚未绑定。打开 /console 设置里的 Channels，生成绑定码，发到这里。";
    }
    const user = this.db.users.getById(binding.user_id);
    if (!user || user.disabled || !user.can_reply) {
      return "这个微信绑定的账号没有回复权，或已被停用。";
    }

    const lower = text.toLowerCase();
    if (lower === "列表" || lower === "list") return this.listText();
    if (lower === "取消" || lower === "cancel") return this.cancelLast(msg.fromUser, user.id);
    if (lower === "工具" || lower === "/tool") {
      return "工具调用请在控制台 Sessions 里操作。这里只接受文字回复。";
    }

    const numbered = /^(\d+)[\s.、:：]+([\s\S]+)$/.exec(text);
    const jobs = liveJobs(this.engine);
    let job: JobSummary | undefined;
    let body = text;
    if (numbered) {
      const idx = Number(numbered[1]) - 1;
      job = jobs[idx];
      body = numbered[2]!.trim();
    } else if (jobs.length === 1) {
      job = jobs[0];
    } else if (jobs.length > 1) {
      const lastId = this.lastJob.get(msg.fromUser);
      job = jobs.find((j) => j.id === lastId) ?? undefined;
      if (!job) return `当前有 ${jobs.length} 条会话。发「列表」后用「1 回复内容」指定。`;
    }
    if (!job) return "现在没有等待回复的会话。";
    if (!body) return "回复内容是空的。";

    try {
      await this.engine.completeFromTest(job.id, [{ type: "text", text: body }], { sessionId: user.id });
      this.lastJob.delete(msg.fromUser);
      return "已回复到会话。";
    } catch (err) {
      return err instanceof Error ? err.message : "回复失败。";
    }
  }

  private consumeBind(accountId: string, openid: string, code: string): string {
    const row = this.codes.get(code);
    this.codes.delete(code);
    if (!row || row.expiresAt <= this.now() || row.accountId !== accountId) {
      return "绑定码无效或已过期。请在控制台重新生成。";
    }
    const user = this.db.users.getById(row.userId);
    if (!user || user.disabled || !user.can_reply) {
      return "这个绑定码对应的账号没有回复权。";
    }
    this.db.channels.insertBinding({
      id: newBindingId(),
      account_id: accountId,
      user_id: user.id,
      peer_id: openid,
      created_at: this.now(),
    });
    return `已绑定 ${user.username}。新会话会推到这里，直接回复即可。发「列表」查看进行中的会话。`;
  }

  private listText(): string {
    const jobs = liveJobs(this.engine);
    if (jobs.length === 0) return "没有等待回复的会话。";
    return `进行中 ${jobs.length} 条：\n${jobs.map((j, i) => jobLine(j, i)).join("\n\n")}\n\n回复「1 你的回答」指定会话。`;
  }

  private async cancelLast(openid: string, userId: string): Promise<string> {
    const jobs = liveJobs(this.engine);
    const lastId = this.lastJob.get(openid);
    const job = jobs.find((j) => j.id === lastId) ?? (jobs.length === 1 ? jobs[0] : undefined);
    if (!job) return "没有可取消的会话。发「列表」查看。";
    await this.engine.cancel(job.id, "operator");
    this.lastJob.delete(openid);
    void userId;
    return "已取消该会话。";
  }

  private async sendCustom(appId: string, secret: string, openid: string, content: string): Promise<void> {
    const token = await this.token(appId, secret);
    const res = await this.wxFetch(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ touser: openid, msgtype: "text", text: { content } }),
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!res.ok) throw new Error(`wechat custom send ${res.status}`);
    const body = (await res.json()) as { errcode?: number };
    if (body.errcode && body.errcode !== 0) throw new Error(`wechat custom send ${body.errcode}`);
  }

  private async token(appId: string, secret: string): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) return this.accessToken.value;
    const res = await this.wxFetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    const body = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number };
    if (!body.access_token) throw new Error(`wechat token ${body.errcode ?? res.status}`);
    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(60, (body.expires_in ?? 7200) - 120) * 1000,
    };
    return body.access_token;
  }
}
