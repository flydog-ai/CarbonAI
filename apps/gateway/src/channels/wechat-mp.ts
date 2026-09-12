import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function wechatSignature(token: string, timestamp: string, nonce: string, extra = ""): string {
  const parts = extra ? [token, timestamp, nonce, extra] : [token, timestamp, nonce];
  parts.sort();
  return createHash("sha1").update(parts.join("")).digest("hex");
}

export function wechatSignatureOk(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string,
  extra = "",
): boolean {
  if (!token || !timestamp || !nonce || !signature) return false;
  const expected = Buffer.from(wechatSignature(token, timestamp, nonce, extra));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function xmlField(xml: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i").exec(xml);
  if (cdata?.[1] !== undefined) return cdata[1];
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return plain?.[1];
}

export type WechatInbound = {
  toUser: string;
  fromUser: string;
  msgType: string;
  content: string;
  event: string;
};

export function parseWechatXml(xml: string): WechatInbound {
  return {
    toUser: xmlField(xml, "ToUserName") ?? "",
    fromUser: xmlField(xml, "FromUserName") ?? "",
    msgType: (xmlField(xml, "MsgType") ?? "").toLowerCase(),
    content: (xmlField(xml, "Content") ?? "").trim(),
    event: (xmlField(xml, "Event") ?? "").toLowerCase(),
  };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function wechatTextReply(fromOa: string, toOpenid: string, text: string, now = Date.now()): string {
  const ts = Math.floor(now / 1000);
  const body = text.replaceAll("]]>", "]] >");
  return `<xml><ToUserName><![CDATA[${xmlEscape(toOpenid)}]]></ToUserName><FromUserName><![CDATA[${xmlEscape(fromOa)}]]></FromUserName><CreateTime>${ts}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${body}]]></Content></xml>`;
}

function pkcs7Pad(buf: Buffer): Buffer {
  const pad = 32 - (buf.length % 32);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const n = buf[buf.length - 1];
  if (!n || n > 32 || n > buf.length) return buf;
  return buf.subarray(0, buf.length - n);
}

export function aesKeyFromEncoding(encodingAesKey: string): Buffer {
  const padded = encodingAesKey.endsWith("=") ? encodingAesKey : `${encodingAesKey}=`;
  const key = Buffer.from(padded, "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey must decode to 32 bytes");
  return key;
}

export function encryptWechatMsg(encodingAesKey: string, appId: string, xml: string): string {
  const key = aesKeyFromEncoding(encodingAesKey);
  const iv = key.subarray(0, 16);
  const random = randomBytes(16);
  const body = Buffer.from(xml, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const packed = pkcs7Pad(Buffer.concat([random, len, body, Buffer.from(appId, "utf8")]));
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(packed), cipher.final()]).toString("base64");
}

export function decryptWechatMsg(encodingAesKey: string, appId: string, cipherText: string): string {
  const key = aesKeyFromEncoding(encodingAesKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const raw = pkcs7Unpad(Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]));
  const msgLen = raw.readUInt32BE(16);
  const msg = raw.subarray(20, 20 + msgLen).toString("utf8");
  const id = raw.subarray(20 + msgLen).toString("utf8");
  if (id && appId && id !== appId) throw new Error("wechat encrypt appId mismatch");
  return msg;
}

export function wechatEncryptedEnvelope(opts: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
}): string {
  const sign = wechatSignature(opts.token, opts.timestamp, opts.nonce, opts.encrypt);
  return `<xml><Encrypt><![CDATA[${opts.encrypt}]]></Encrypt><MsgSignature><![CDATA[${sign}]]></MsgSignature><TimeStamp>${xmlEscape(opts.timestamp)}</TimeStamp><Nonce><![CDATA[${opts.nonce}]]></Nonce></xml>`;
}

export function maskPeer(peer: string): string {
  if (peer.length <= 8) return peer;
  return `${peer.slice(0, 2)}…${peer.slice(-4)}`;
}
