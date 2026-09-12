import { describe, expect, test } from "bun:test";
import {
  decryptWechatMsg,
  encryptWechatMsg,
  parseWechatXml,
  wechatSignature,
  wechatSignatureOk,
  wechatTextReply,
  xmlField,
} from "./wechat-mp.ts";

const token = "carbonToken";
const aesKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const appId = "wx1234567890abcd";

describe("wechat signature", () => {
  test("matches sorted sha1", () => {
    const sig = wechatSignature(token, "1409304348", "nonce");
    expect(sig).toHaveLength(40);
    expect(wechatSignatureOk(token, "1409304348", "nonce", sig)).toBe(true);
    expect(wechatSignatureOk(token, "1409304348", "nonce", "0".repeat(40))).toBe(false);
  });
});

describe("xml", () => {
  test("reads CDATA fields", () => {
    const xml = `<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[oABC]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[BIND-7K3M]]></Content></xml>`;
    const msg = parseWechatXml(xml);
    expect(msg.toUser).toBe("gh");
    expect(msg.fromUser).toBe("oABC");
    expect(msg.msgType).toBe("text");
    expect(msg.content).toBe("BIND-7K3M");
    expect(xmlField(xml, "Content")).toBe("BIND-7K3M");
  });

  test("text reply is xml", () => {
    const out = wechatTextReply("gh", "oABC", "ok", 1_000_000);
    expect(out).toContain("<ToUserName><![CDATA[oABC]]></ToUserName>");
    expect(out).toContain("<Content><![CDATA[ok]]></Content>");
  });
});

describe("aes", () => {
  test("encrypt then decrypt round-trips", () => {
    const xml = `<xml><Content><![CDATA[hello]]></Content></xml>`;
    const enc = encryptWechatMsg(aesKey, appId, xml);
    expect(decryptWechatMsg(aesKey, appId, enc)).toBe(xml);
  });
});
