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
import {
  fetchBotQr,
  getUpdates,
  ILINK_QR_BASE,
  pollQrStatus,
  qrImageDataUrl,
  sendBotText,
  textFromIlink,
  type IlinkFetch,
} from "./weixin-ilink.ts";

const KIND = "wechat_mp";
const KIND_BOT = "wechat_bot";
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
  pushReady: boolean;
  lastPushError?: string;
};

export type WechatBotPublic = {
  id: string;
  kind: typeof KIND_BOT;
  enabled: boolean;
  connected: boolean;
  botId: string;
  bound: number;
};

type BindCode = { userId: string; accountId: string; expiresAt: number };
type QrSession = {
  qrcode: string;
  qrcodeUrl: string;
  userId: string;
  startedAt: number;
  pollBase: string;
  verifyCode?: string;
};

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
  private readonly lastContext = new Map<string, string>();
  private readonly qrSessions = new Map<string, QrSession>();
  private accessToken?: { value: string; expiresAt: number };
  private botAbort?: AbortController;
  private lastPushError?: string;

  constructor(
    private readonly cfg: Config,
    private readonly db: CarbonDb,
    private readonly engine: JobEngine,
    private readonly now: () => number = Date.now,
    private readonly wxFetch: WxFetch = fetch,
    private readonly ilinkFetch: IlinkFetch = fetch,
  ) {}

  start(): void {
    this.restartBotMonitor();
  }

  stop(): void {
    this.botAbort?.abort();
    this.botAbort = undefined;
  }

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
      pushReady: Boolean(row.app_id && row.app_secret && row.enabled === 1),
      lastPushError: this.lastPushError,
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
      base_url: current?.base_url ?? null,
      sync_buf: current?.sync_buf ?? null,
    });
    this.accessToken = undefined;
    return this.publicWechat()!;
  }

  mintBindCode(userId: string): { code: string; expiresAt: number } {
    const account = this.enabledAccount() ?? this.enabledBot();
    if (!account) throw new Error("wechat channel is not enabled");
    const code = newCode();
    const expiresAt = this.now() + BIND_TTL_MS;
    this.codes.set(code, { userId, accountId: account.id, expiresAt });
    return { code, expiresAt };
  }

  bindingFor(userId: string): {
    wechat: { bound: boolean; peerMasked?: string };
    wechatBot: { bound: boolean; peerMasked?: string; connected: boolean };
    enabled: boolean;
  } {
    const mp = this.bindingOn(KIND, userId);
    const bot = this.enabledBot();
    const botBind = this.bindingOn(KIND_BOT, userId);
    return {
      wechat: mp,
      wechatBot: { ...botBind, connected: Boolean(bot?.token && bot.base_url) },
      enabled: Boolean(this.enabledAccount() || bot),
    };
  }

  unbind(userId: string): void {
    for (const kind of [KIND, KIND_BOT]) {
      const account = this.db.channels.getByKind(kind);
      if (account) this.db.channels.deleteBindingByUser(account.id, userId);
    }
  }

  publicWechatBot(): WechatBotPublic | null {
    const row = this.db.channels.getByKind(KIND_BOT);
    if (!row) return null;
    return {
      id: row.id,
      kind: KIND_BOT,
      enabled: row.enabled === 1,
      connected: Boolean(row.token && row.base_url && row.enabled === 1),
      botId: row.app_id,
      bound: this.db.channels.listBindings(row.id).length,
    };
  }

  async startBotQr(userId: string): Promise<{ sessionKey: string; qrcodeUrl: string; qrImage: string }> {
    const qr = await fetchBotQr(this.ilinkFetch);
    const sessionKey = crypto.randomUUID();
    this.qrSessions.set(sessionKey, {
      qrcode: qr.qrcode,
      qrcodeUrl: qr.qrcodeUrl,
      userId,
      startedAt: this.now(),
      pollBase: ILINK_QR_BASE,
    });
    const qrImage = await qrImageDataUrl(qr.qrcodeUrl);
    return { sessionKey, qrcodeUrl: qr.qrcodeUrl, qrImage };
  }

  async pollBotQr(
    sessionKey: string,
    verifyCode?: string,
  ): Promise<{
    status: string;
    qrcodeUrl?: string;
    connected?: boolean;
    wechatBot?: WechatBotPublic;
    message?: string;
  }> {
    const session = this.qrSessions.get(sessionKey);
    if (!session || this.now() - session.startedAt > 8 * 60_000) {
      this.qrSessions.delete(sessionKey);
      return { status: "expired", message: "二维码已过期，请重新生成。" };
    }
    if (verifyCode) session.verifyCode = verifyCode;
    const st = await pollQrStatus(this.ilinkFetch, session.qrcode, {
      baseUrl: session.pollBase,
      verifyCode: session.verifyCode,
    });
    if (st.status === "scaned_but_redirect" && st.redirect_host) {
      session.pollBase = `https://${st.redirect_host}`;
      return { status: st.status, qrcodeUrl: session.qrcodeUrl };
    }
    if (st.status === "confirmed") {
      if (!st.bot_token || !st.ilink_bot_id) {
        this.qrSessions.delete(sessionKey);
        return { status: "error", message: "登录成功但未返回 bot token。" };
      }
      const current = this.db.channels.getByKind(KIND_BOT);
      this.db.channels.upsertByKind({
        id: current?.id ?? newChannelId(),
        kind: KIND_BOT,
        label: "WeChat Bot",
        app_id: st.ilink_bot_id,
        app_secret: null,
        token: st.bot_token,
        aes_key: null,
        enabled: 1,
        created_at: current?.created_at ?? this.now(),
        base_url: (st.baseurl || ILINK_QR_BASE).replace(/\/$/, ""),
        sync_buf: null,
      });
      const account = this.db.channels.getByKind(KIND_BOT)!;
      if (st.ilink_user_id) {
        this.db.channels.insertBinding({
          id: newBindingId(),
          account_id: account.id,
          user_id: session.userId,
          peer_id: st.ilink_user_id,
          created_at: this.now(),
        });
      }
      this.qrSessions.delete(sessionKey);
      this.restartBotMonitor();
      return { status: "confirmed", connected: true, wechatBot: this.publicWechatBot()! };
    }
    if (st.status === "expired" || st.status === "binded_redirect") {
      this.qrSessions.delete(sessionKey);
    }
    return { status: st.status, qrcodeUrl: session.qrcodeUrl };
  }

  logoutBot(): void {
    const current = this.db.channels.getByKind(KIND_BOT);
    if (!current) return;
    this.db.channels.upsertByKind({
      ...current,
      token: "",
      enabled: 0,
      base_url: null,
      sync_buf: null,
    });
    this.stop();
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
    const reply = await this.dispatchMp(account.id, msg);
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
    let text: string;
    try {
      text = this.notifyText(job);
    } catch {
      return;
    }
    const mp = this.enabledAccount();
    if (mp && this.db.channels.listBindings(mp.id).length > 0 && !(mp.app_id && mp.app_secret)) {
      this.lastPushError = "missing AppId/AppSecret";
    }
    if (mp?.app_id && mp.app_secret) {
      for (const b of this.db.channels.listBindings(mp.id)) {
        this.lastJob.set(b.peer_id, job.id);
        try {
          await this.sendCustom(mp.app_id, mp.app_secret, b.peer_id, text);
          this.lastPushError = undefined;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastPushError = msg;
          console.warn(`wechat mp push failed peer=${b.peer_id}: ${msg}`);
        }
      }
    }
    const bot = this.enabledBot();
    if (bot?.token && bot.base_url) {
      for (const b of this.db.channels.listBindings(bot.id)) {
        this.lastJob.set(b.peer_id, job.id);
        try {
          await sendBotText(this.ilinkFetch, {
            baseUrl: bot.base_url,
            token: bot.token,
            toUserId: b.peer_id,
            text,
            contextToken: this.lastContext.get(b.peer_id),
          });
        } catch {
          /* long-poll inbound still works */
        }
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
    try {
      const row = this.db.channels.getByKind(KIND);
      if (!row || row.enabled !== 1 || !row.token) return null;
      return row;
    } catch {
      return null;
    }
  }

  private enabledBot() {
    try {
      const row = this.db.channels.getByKind(KIND_BOT);
      if (!row || row.enabled !== 1 || !row.token || !row.base_url) return null;
      return row;
    } catch {
      return null;
    }
  }

  private bindingOn(kind: string, userId: string): { bound: boolean; peerMasked?: string } {
    const account = this.db.channels.getByKind(kind);
    if (!account) return { bound: false };
    const row = this.db.channels.getBindingByUser(account.id, userId);
    if (!row) return { bound: false };
    return { bound: true, peerMasked: maskPeer(row.peer_id) };
  }

  private restartBotMonitor(): void {
    this.stop();
    const bot = this.enabledBot();
    if (!bot) return;
    this.botAbort = new AbortController();
    void this.botLoop(bot.id, this.botAbort.signal);
  }

  private async botLoop(accountId: string, abort: AbortSignal): Promise<void> {
    let failures = 0;
    while (!abort.aborted) {
      if (abort.aborted) return;
      let account;
      try {
        account = this.db.channels.getById(accountId);
      } catch {
        return;
      }
      if (!account?.token || !account.base_url || account.enabled !== 1) return;
      try {
        const resp = await getUpdates(this.ilinkFetch, {
          baseUrl: account.base_url,
          token: account.token,
          buf: account.sync_buf ?? "",
          abort,
        });
        if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
          failures += 1;
          await Bun.sleep(failures >= 3 ? 30_000 : 2_000);
          if (failures >= 3) failures = 0;
          continue;
        }
        failures = 0;
        if (resp.get_updates_buf) this.db.channels.setSyncBuf(account.id, resp.get_updates_buf);
        const list = resp.msgs ?? [];
        if (list.length === 0) {
          await Bun.sleep(400);
          continue;
        }
        for (const msg of list) {
          if (msg.message_type === 2) continue;
          const peer = msg.from_user_id ?? "";
          if (!peer) continue;
          if (msg.context_token) this.lastContext.set(peer, msg.context_token);
          const text = textFromIlink(msg);
          if (!text) continue;
          const reply = await this.handlePeerText(account.id, peer, text);
          if (!reply) continue;
          try {
            await sendBotText(this.ilinkFetch, {
              baseUrl: account.base_url,
              token: account.token,
              toUserId: peer,
              text: reply,
              contextToken: msg.context_token ?? this.lastContext.get(peer),
            });
          } catch {
            /* next poll still works */
          }
        }
      } catch {
        if (abort.aborted) return;
        failures += 1;
        await Bun.sleep(failures >= 3 ? 30_000 : 2_000);
        if (failures >= 3) failures = 0;
      }
    }
  }

  private async dispatchMp(
    accountId: string,
    msg: { fromUser: string; msgType: string; content: string; event: string },
  ): Promise<string | undefined> {
    if (msg.msgType === "event" && (msg.event === "subscribe" || msg.event === "scan")) {
      return "发送绑定码（控制台 Channels 里复制）以绑定操作者。绑定后新会话会推到这里，直接回复即可。";
    }
    if (msg.msgType !== "text" || !msg.content) return undefined;
    return this.handlePeerText(accountId, msg.fromUser, msg.content.trim());
  }

  private async handlePeerText(accountId: string, fromUser: string, text: string): Promise<string | undefined> {
    if (!text) return undefined;
    const bind = /^BIND-([0-9A-HJKMNP-TV-Z]{5})$/i.exec(text);
    if (bind) {
      return this.consumeBind(accountId, fromUser, text.toUpperCase());
    }

    const binding = this.db.channels.getBindingByPeer(accountId, fromUser);
    if (!binding) {
      return "尚未绑定。打开 /console 设置里的 Channels，生成绑定码，发到这里。";
    }
    const user = this.db.users.getById(binding.user_id);
    if (!user || user.disabled || !user.can_reply) {
      return "这个微信绑定的账号没有回复权，或已被停用。";
    }

    const lower = text.toLowerCase();
    if (lower === "列表" || lower === "list") return this.listText();
    if (lower === "取消" || lower === "cancel") return this.cancelLast(fromUser, user.id);
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
      const lastId = this.lastJob.get(fromUser);
      job = jobs.find((j) => j.id === lastId) ?? undefined;
      if (!job) return `当前有 ${jobs.length} 条会话。发「列表」后用「1 回复内容」指定。`;
    }
    if (!job) return "现在没有等待回复的会话。";
    if (!body) return "回复内容是空的。";

    try {
      await this.engine.completeFromTest(job.id, [{ type: "text", text: body }], { sessionId: user.id });
      this.lastJob.delete(fromUser);
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
    return `已绑定 ${user.username}。
回复位置：微信里打开本公众号的对话（不是控制台，也不是别的 Bot）。
订阅号通常不能主动推送。有新会话时请在这里发「列表」，然后直接打字回复。`;
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
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`wechat custom send ${res.status}`);
    const body = (await res.json()) as { errcode?: number; errmsg?: string };
    if (body.errcode && body.errcode !== 0) {
      throw new Error(`wechat custom send ${body.errcode} ${body.errmsg ?? ""}`.trim());
    }
  }

  private async token(appId: string, secret: string): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) return this.accessToken.value;
    const res = await this.wxFetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(10_000) },
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
