import type { Config } from "@carbon-ai/config";
import { newBindingId, newChannelEventId, newChannelId, type CarbonDb, type ChannelAccountRow } from "@carbon-ai/db";
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
  dingtalkSignOk,
  dingtalkText,
  dingtalkWebhookSend,
  feishuChallenge,
  feishuSend,
  feishuText,
  feishuTokenOk,
} from "./feishu.ts";
import { telegramLoop, telegramSend } from "./telegram.ts";
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
const KIND_TG = "telegram";
const KIND_FS = "feishu";
const KIND_DD = "dingtalk";
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
  token?: string;
  aesKey?: string;
  secretPrefix?: string;
  peerMasked?: string;
};

export type ChannelEventView = {
  at: number;
  level: string;
  event: string;
  detail?: string;
};

export type GenericChannelPublic = {
  kind: string;
  enabled: boolean;
  appId?: string;
  tokenSet: boolean;
  secretSet: boolean;
  tokenPrefix?: string;
  webhook?: string;
  bound: number;
  peerMasked?: string;
};

export type WechatBotPublic = {
  id: string;
  kind: typeof KIND_BOT;
  enabled: boolean;
  connected: boolean;
  botId: string;
  bound: number;
  peerMasked?: string;
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

function maskSecret(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 2)}••••${value.slice(-4)}`;
}

function liveJobs(engine: JobEngine, ownerId?: string, siteDeskId?: string): JobSummary[] {
  return engine
    .list()
    .filter((j) => LIVE.has(j.status) && (!ownerId || (j.ownerId ?? siteDeskId) === ownerId))
    .sort((a, b) => a.createdAt - b.createdAt);
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
  private readonly accessTokens = new Map<string, { value: string; expiresAt: number }>();
  private readonly botLoops = new Map<string, AbortController>();
  private readonly tgLoops = new Map<string, AbortController>();
  private readonly lastPush = new Map<string, string>();

  constructor(
    private readonly cfg: Config,
    private readonly db: CarbonDb,
    private readonly engine: JobEngine,
    private readonly now: () => number = Date.now,
    private readonly wxFetch: WxFetch = fetch,
    private readonly ilinkFetch: IlinkFetch = fetch,
  ) {}

  start(): void {
    this.restartAllBots();
    this.restartAllTelegram();
  }

  stop(): void {
    for (const ac of this.botLoops.values()) ac.abort();
    this.botLoops.clear();
    for (const ac of this.tgLoops.values()) ac.abort();
    this.tgLoops.clear();
  }

  callbackInfo(requestUrl: string): { callbackUrl: string; httpsRequired: boolean } {
    const origin = siteOrigin(this.cfg, requestUrl);
    return {
      callbackUrl: `${origin}/hooks/wechat`,
      httpsRequired: !origin.startsWith("https://"),
    };
  }

  viewFor(userId: string, requestUrl: string) {
    const origin = this.callbackInfo(requestUrl);
    const bind = this.bindingFor(userId);
    return {
      ...origin,
      feishuCallback: origin.callbackUrl.replace(/\/hooks\/wechat$/, "/hooks/feishu"),
      dingtalkCallback: origin.callbackUrl.replace(/\/hooks\/wechat$/, "/hooks/dingtalk"),
      wechat: this.publicWechat(userId),
      wechatBot: this.publicWechatBot(userId),
      telegram: this.publicGeneric("telegram", userId),
      feishu: this.publicGeneric("feishu", userId),
      dingtalk: this.publicGeneric("dingtalk", userId),
      enabled: bind.enabled,
    };
  }

  publicWechat(userId: string): ChannelPublic | null {
    const row = this.db.channels.getByUserKind(userId, KIND);
    if (!row) return null;
    const mine = this.db.channels.getBindingByUser(row.id, userId);
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
      lastPushError: this.lastPush.get(row.id),
      token: row.token || undefined,
      aesKey: row.aes_key || undefined,
      secretPrefix: maskSecret(row.app_secret),
      peerMasked: mine ? maskPeer(mine.peer_id) : undefined,
    };
  }

  listEvents(kind: string, userId: string): ChannelEventView[] {
    return this.db.channels.listEventsForUser(userId, kind, 30).map((e) => ({
      at: e.created_at,
      level: e.level,
      event: e.event,
      detail: e.detail ?? undefined,
    }));
  }

  private log(account: ChannelAccountRow | null | undefined, level: "info" | "warn" | "error", event: string, detail?: string): void {
    if (!account) return;
    try {
      this.db.channels.addEvent({
        id: newChannelEventId(),
        account_id: account.id,
        kind: account.kind,
        level,
        event,
        detail: detail ?? null,
        created_at: this.now(),
      });
    } catch {
      /* logging must not break the channel */
    }
  }

  upsertWechat(
    userId: string,
    input: {
      label?: string;
      appId?: string;
      appSecret?: string;
      token?: string;
      aesKey?: string | null;
      enabled?: boolean;
    },
  ): ChannelPublic {
    const current = this.db.channels.getByUserKind(userId, KIND);
    const appId = input.appId !== undefined ? input.appId.trim() : (current?.app_id ?? "");
    const token = input.token !== undefined ? input.token.trim() : (current?.token ?? "");
    const secret =
      input.appSecret !== undefined ? input.appSecret.trim() || null : (current?.app_secret ?? null);
    const aes = input.aesKey !== undefined ? (input.aesKey?.trim() || null) : (current?.aes_key ?? null);
    const enabled = input.enabled === undefined ? (current?.enabled ?? 0) : input.enabled ? 1 : 0;
    if (enabled && !token) throw new Error("token required");
    const label = (input.label ?? current?.label ?? "WeChat MP").trim() || "WeChat MP";
    this.db.channels.upsertByKind({
      id: current?.id ?? newChannelId(),
      user_id: userId,
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
    this.accessTokens.delete(appId);
    const row = this.db.channels.getByUserKind(userId, KIND);
    if (input.enabled !== undefined) this.log(row, "info", enabled ? "enabled" : "disabled");
    return this.publicWechat(userId)!;
  }

  mintBindCode(userId: string): { code: string; expiresAt: number } {
    const account =
      this.enabledFor(userId, KIND) ??
      this.enabledFor(userId, KIND_BOT) ??
      this.enabledFor(userId, KIND_TG) ??
      this.enabledFor(userId, KIND_FS) ??
      this.enabledFor(userId, KIND_DD);
    if (!account) throw new Error("no channel is enabled");
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
    const mp = this.bindingOn(userId, KIND);
    const bot = this.enabledFor(userId, KIND_BOT);
    const botBind = this.bindingOn(userId, KIND_BOT);
    return {
      wechat: mp,
      wechatBot: { ...botBind, connected: Boolean(bot?.token && bot.base_url) },
      enabled: Boolean(this.enabledFor(userId, KIND) || bot),
    };
  }

  unbind(userId: string): void {
    for (const kind of [KIND, KIND_BOT, KIND_TG, KIND_FS, KIND_DD]) {
      const account = this.db.channels.getByUserKind(userId, kind);
      if (account) this.db.channels.deleteBindingByUser(account.id, userId);
    }
  }

  publicWechatBot(userId: string): WechatBotPublic | null {
    const row = this.db.channels.getByUserKind(userId, KIND_BOT);
    if (!row) return null;
    const mine = this.db.channels.getBindingByUser(row.id, userId);
    return {
      id: row.id,
      kind: KIND_BOT,
      enabled: row.enabled === 1,
      connected: Boolean(row.token && row.base_url && row.enabled === 1),
      botId: row.app_id,
      bound: this.db.channels.listBindings(row.id).length,
      peerMasked: mine ? maskPeer(mine.peer_id) : undefined,
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
    userId?: string,
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
    if (userId && session.userId !== userId) {
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
      const current = this.db.channels.getByUserKind(session.userId, KIND_BOT);
      this.db.channels.upsertByKind({
        id: current?.id ?? newChannelId(),
        user_id: session.userId,
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
      const account = this.db.channels.getByUserKind(session.userId, KIND_BOT)!;
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
      this.restartAllBots();
      this.log(account, "info", "login", st.ilink_bot_id);
      return { status: "confirmed", connected: true, wechatBot: this.publicWechatBot(session.userId)! };
    }
    if (st.status === "expired" || st.status === "binded_redirect") {
      this.qrSessions.delete(sessionKey);
    }
    return { status: st.status, qrcodeUrl: session.qrcodeUrl };
  }

  logoutBot(userId: string): void {
    const current = this.db.channels.getByUserKind(userId, KIND_BOT);
    if (!current) return;
    this.db.channels.upsertByKind({
      ...current,
      token: "",
      enabled: 0,
      base_url: null,
      sync_buf: null,
    });
    const ac = this.botLoops.get(current.id);
    ac?.abort();
    this.botLoops.delete(current.id);
  }

  publicGeneric(kind: string, userId: string): GenericChannelPublic | null {
    const row = this.db.channels.getByUserKind(userId, kind);
    if (!row) return null;
    const mine = this.db.channels.getBindingByUser(row.id, userId);
    return {
      kind,
      enabled: row.enabled === 1,
      appId: row.app_id || undefined,
      tokenSet: Boolean(row.token),
      secretSet: Boolean(row.app_secret),
      tokenPrefix: maskSecret(row.token),
      webhook: row.base_url || undefined,
      bound: this.db.channels.listBindings(row.id).length,
      peerMasked: mine ? maskPeer(mine.peer_id) : undefined,
    };
  }

  upsertGeneric(
    kind: string,
    userId: string,
    input: {
      label?: string;
      appId?: string;
      appSecret?: string;
      token?: string;
      enabled?: boolean;
      webhook?: string;
    },
  ): GenericChannelPublic {
    const current = this.db.channels.getByUserKind(userId, kind);
    const token = input.token !== undefined ? input.token.trim() : (current?.token ?? "");
    const secret =
      input.appSecret !== undefined ? input.appSecret.trim() || null : (current?.app_secret ?? null);
    const appId = input.appId !== undefined ? input.appId.trim() : (current?.app_id ?? "");
    const webhook =
      input.webhook !== undefined ? input.webhook.trim() || null : (current?.base_url ?? null);
    const enabled = input.enabled === undefined ? (current?.enabled ?? 0) : input.enabled ? 1 : 0;
    if (enabled && kind === KIND_TG && !token) throw new Error("bot token required");
    if (enabled && kind === KIND_FS && !(appId && secret)) throw new Error("app id and secret required");
    const labels: Record<string, string> = { telegram: "Telegram", feishu: "Feishu", dingtalk: "DingTalk" };
    this.db.channels.upsertByKind({
      id: current?.id ?? newChannelId(),
      user_id: userId,
      kind,
      label: input.label ?? current?.label ?? labels[kind] ?? kind,
      app_id: appId,
      app_secret: secret,
      token,
      aes_key: current?.aes_key ?? null,
      enabled,
      created_at: current?.created_at ?? this.now(),
      base_url: webhook,
      sync_buf: current?.sync_buf ?? null,
    });
    if (kind === KIND_TG) this.restartAllTelegram();
    const row = this.db.channels.getByUserKind(userId, kind);
    if (input.enabled !== undefined) this.log(row, "info", enabled ? "enabled" : "disabled");
    return this.publicGeneric(kind, userId)!;
  }

  async handleFeishu(body: unknown): Promise<unknown> {
    const challenge = feishuChallenge(body);
    if (challenge) return { challenge };
    const presented =
      (body as { token?: string; header?: { token?: string } }).token ??
      (body as { header?: { token?: string } }).header?.token;
    const accounts = this.db.channels.listEnabled(KIND_FS);
    const account =
      accounts.find((a) => a.token && presented && feishuTokenOk(a.token, presented)) ??
      (accounts.length === 1 && !accounts[0]!.token ? accounts[0] : undefined);
    if (!account) return {};
    if (account.token && !feishuTokenOk(account.token, presented)) return {};
    const msg = feishuText(body);
    if (!msg) return {};
    const reply = await this.handlePeerText(account.id, msg.peerId, msg.text);
    if (reply && account.app_id && account.app_secret) {
      try {
        await feishuSend(this.wxFetch, {
          appId: account.app_id,
          appSecret: account.app_secret,
          openId: msg.peerId,
          text: reply,
        });
      } catch (err) {
        this.log(account, "error", "send", err instanceof Error ? err.message : String(err));
      }
    }
    return {};
  }

  async handleDingTalk(
    headers: { timestamp?: string; sign?: string },
    body: unknown,
  ): Promise<unknown> {
    const accounts = this.db.channels.listEnabled(KIND_DD);
    let account: ChannelAccountRow | undefined;
    for (const row of accounts) {
      if (row.app_secret) {
        if (dingtalkSignOk(row.app_secret, headers.timestamp ?? "", headers.sign ?? "")) {
          account = row;
          break;
        }
        continue;
      }
      if (accounts.length === 1) account = row;
    }
    if (!account) return {};
    const msg = dingtalkText(body);
    if (!msg) return {};
    const reply = await this.handlePeerText(account.id, msg.peerId, msg.text);
    if (reply) return { msgtype: "text", text: { content: reply } };
    return {};
  }

  verifyGet(query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }): string | undefined {
    for (const account of this.db.channels.listEnabled(KIND)) {
      if (!account.token) continue;
      if (
        wechatSignatureOk(
          account.token,
          query.timestamp ?? "",
          query.nonce ?? "",
          query.signature ?? "",
        )
      ) {
        return query.echostr ?? "";
      }
    }
    return undefined;
  }

  async handlePost(
    query: { signature?: string; timestamp?: string; nonce?: string; msg_signature?: string; encrypt_type?: string },
    rawXml: string,
  ): Promise<string> {
    const encryptType = (query.encrypt_type ?? "").toLowerCase();
    const encrypted = xmlField(rawXml, "Encrypt");
    for (const account of this.db.channels.listEnabled(KIND)) {
      if (!account.token) continue;
      let xml = rawXml;
      if (encrypted && (encryptType === "aes" || account.aes_key)) {
        const msgSig = query.msg_signature ?? query.signature ?? "";
        if (!wechatSignatureOk(account.token, query.timestamp ?? "", query.nonce ?? "", msgSig, encrypted)) {
          continue;
        }
        if (!account.aes_key) continue;
        try {
          xml = decryptWechatMsg(account.aes_key, account.app_id, encrypted);
        } catch {
          continue;
        }
      } else if (
        !wechatSignatureOk(account.token, query.timestamp ?? "", query.nonce ?? "", query.signature ?? "")
      ) {
        continue;
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
    return "success";
  }

  async notify(job: JobSummary): Promise<void> {
    let text: string;
    try {
      text = this.notifyText(job);
    } catch {
      return;
    }
    const ownerId = job.ownerId ?? this.db.users.siteDeskId();
    if (!ownerId) return;

    const mp = this.enabledFor(ownerId, KIND);
    if (mp && this.db.channels.listBindings(mp.id).length > 0 && !(mp.app_id && mp.app_secret)) {
      this.lastPush.set(mp.id, "missing AppId/AppSecret");
    }
    if (mp?.app_id && mp.app_secret) {
      for (const b of this.db.channels.listBindings(mp.id)) {
        if (b.user_id !== ownerId) continue;
        this.lastJob.set(b.peer_id, job.id);
        try {
          await this.sendCustom(mp.app_id, mp.app_secret, b.peer_id, text);
          this.lastPush.delete(mp.id);
          this.log(mp, "info", "push", `ok ${b.peer_id.slice(0, 8)}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastPush.set(mp.id, msg);
          this.log(mp, "error", "push", msg);
          console.warn(`wechat mp push failed peer=${b.peer_id}: ${msg}`);
        }
      }
    }
    const bot = this.enabledFor(ownerId, KIND_BOT);
    if (bot?.token && bot.base_url) {
      for (const b of this.db.channels.listBindings(bot.id)) {
        if (b.user_id !== ownerId) continue;
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
    await this.notifyOwned(KIND_TG, ownerId, job.id, async (row, peer) => {
      if (!row.token) return;
      await telegramSend(this.wxFetch, row.token, peer, text);
    });
    await this.notifyOwned(KIND_FS, ownerId, job.id, async (row, peer) => {
      if (!row.app_id || !row.app_secret) return;
      await feishuSend(this.wxFetch, { appId: row.app_id, appSecret: row.app_secret, openId: peer, text });
    });
    await this.notifyOwned(KIND_DD, ownerId, job.id, async (row) => {
      if (!row.base_url) return;
      await dingtalkWebhookSend(this.wxFetch, row.base_url, text);
    });
  }

  private async notifyOwned(
    kind: string,
    ownerId: string,
    jobId: string,
    send: (row: ChannelAccountRow, peer: string) => Promise<void>,
  ): Promise<void> {
    let row: ChannelAccountRow | null;
    try {
      row = this.db.channels.getByUserKind(ownerId, kind);
    } catch {
      return;
    }
    if (!row || row.enabled !== 1) return;
    const bindings = this.db.channels.listBindings(row.id).filter((b) => b.user_id === ownerId);
    if (kind === KIND_DD && row.base_url && bindings.length === 0) {
      try {
        await send(row, "");
        this.log(row, "info", "push", "webhook");
      } catch (err) {
        this.log(row, "error", "push", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    for (const b of bindings) {
      this.lastJob.set(b.peer_id, jobId);
      try {
        await send(row, b.peer_id);
        this.log(row, "info", "push", b.peer_id.slice(0, 12));
      } catch (err) {
        this.log(row, "error", "push", err instanceof Error ? err.message : String(err));
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

  private enabledFor(userId: string, kind: string): ChannelAccountRow | null {
    try {
      const row = this.db.channels.getByUserKind(userId, kind);
      if (!row || row.enabled !== 1) return null;
      if (kind === KIND && !row.token) return null;
      if (kind === KIND_BOT && !(row.token && row.base_url)) return null;
      return row;
    } catch {
      return null;
    }
  }

  private bindingOn(userId: string, kind: string): { bound: boolean; peerMasked?: string } {
    const account = this.db.channels.getByUserKind(userId, kind);
    if (!account) return { bound: false };
    const row = this.db.channels.getBindingByUser(account.id, userId);
    if (!row) return { bound: false };
    return { bound: true, peerMasked: maskPeer(row.peer_id) };
  }

  private restartAllBots(): void {
    let live: ChannelAccountRow[] = [];
    try {
      live = this.db.channels.listEnabled(KIND_BOT).filter((b) => b.token && b.base_url);
    } catch {
      return;
    }
    const ids = new Set(live.map((b) => b.id));
    for (const [id, ac] of this.botLoops) {
      if (!ids.has(id)) {
        ac.abort();
        this.botLoops.delete(id);
      }
    }
    for (const row of live) {
      if (this.botLoops.has(row.id)) continue;
      const ac = new AbortController();
      this.botLoops.set(row.id, ac);
      void this.botLoop(row.id, ac.signal);
    }
  }

  private restartAllTelegram(): void {
    let live: ChannelAccountRow[] = [];
    try {
      live = this.db.channels.listEnabled(KIND_TG).filter((b) => Boolean(b.token));
    } catch {
      return;
    }
    const ids = new Set(live.map((b) => b.id));
    for (const [id, ac] of this.tgLoops) {
      if (!ids.has(id)) {
        ac.abort();
        this.tgLoops.delete(id);
      }
    }
    for (const row of live) {
      if (this.tgLoops.has(row.id)) continue;
      const ac = new AbortController();
      this.tgLoops.set(row.id, ac);
      const token = row.token;
      const accountId = row.id;
      void telegramLoop(this.wxFetch, {
        token,
        abort: ac.signal,
        onText: async (peer, text) => this.handlePeerText(accountId, peer, text),
      });
    }
  }

  private async botLoop(accountId: string, abort: AbortSignal): Promise<void> {
    let failures = 0;
    while (!abort.aborted) {
      if (abort.aborted) return;
      let account;
      try {
        account = this.db.channels.getById(accountId);
      } catch {
        this.botLoops.delete(accountId);
        return;
      }
      if (!account?.token || !account.base_url || account.enabled !== 1) {
        this.botLoops.delete(accountId);
        return;
      }
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
    this.botLoops.delete(accountId);
  }

  private async dispatchMp(
    accountId: string,
    msg: { fromUser: string; msgType: string; content: string; event: string },
  ): Promise<string | undefined> {
    if (msg.msgType === "event" && (msg.event === "subscribe" || msg.event === "scan")) {
      return "发送绑定码（控制台连接器里复制）以绑定操作者。绑定后新会话会推到这里，直接回复即可。";
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
      return "尚未绑定。打开 /console 设置里的连接器，生成绑定码，发到这里。";
    }
    const user = this.db.users.getById(binding.user_id);
    if (!user || user.disabled || !user.can_reply) {
      return "这个绑定的账号没有回复权，或已被停用。";
    }

    const lower = text.toLowerCase();
    if (lower === "列表" || lower === "list") return this.listText(user.id);
    if (lower === "取消" || lower === "cancel") return this.cancelLast(fromUser, user.id);
    if (lower === "工具" || lower === "/tool") {
      return "工具调用请在控制台 Sessions 里操作。这里只接受文字回复。";
    }

    const numbered = /^(\d+)[\s.、:：]+([\s\S]+)$/.exec(text);
    const jobs = liveJobs(this.engine, user.id, this.db.users.siteDeskId());
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
      const acc = this.db.channels.getById(accountId);
      this.log(acc, "info", "reply", body.slice(0, 80));
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
    const acc = this.db.channels.getById(accountId);
    this.log(acc, "info", "bind", user.username);
    return `已绑定 ${user.username}。
回复位置：用你绑定的这个连接器对话（微信 Bot / 公众号 / 飞书等），不是别人的。
有新会话时请在这里发「列表」，然后直接打字回复。`;
  }

  private listText(ownerId: string): string {
    const jobs = liveJobs(this.engine, ownerId, this.db.users.siteDeskId());
    if (jobs.length === 0) return "没有等待回复的会话。";
    return `进行中 ${jobs.length} 条：\n${jobs.map((j, i) => jobLine(j, i)).join("\n\n")}\n\n回复「1 你的回答」指定会话。`;
  }

  private async cancelLast(openid: string, userId: string): Promise<string> {
    const jobs = liveJobs(this.engine, userId, this.db.users.siteDeskId());
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
    const cached = this.accessTokens.get(appId);
    if (cached && cached.expiresAt > this.now() + 60_000) return cached.value;
    const res = await this.wxFetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const body = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number };
    if (!body.access_token) throw new Error(`wechat token ${body.errcode ?? res.status}`);
    this.accessTokens.set(appId, {
      value: body.access_token,
      expiresAt: this.now() + Math.max(60, (body.expires_in ?? 7200) - 120) * 1000,
    });
    return body.access_token;
  }
}
