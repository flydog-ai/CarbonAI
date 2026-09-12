import { describe, expect, test } from "bun:test";
import { dingtalkSignOk, dingtalkText, feishuChallenge, feishuText } from "./feishu.ts";
import { createHmac } from "node:crypto";

describe("feishu events", () => {
  test("url verification returns challenge", () => {
    expect(feishuChallenge({ type: "url_verification", challenge: "abc" })).toBe("abc");
    expect(feishuChallenge({ header: { event_type: "im.message.receive_v1" } })).toBeUndefined();
  });

  test("parses text DM", () => {
    const msg = feishuText({
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: { message_type: "text", content: JSON.stringify({ text: "BIND-ABCDE" }) },
      },
    });
    expect(msg).toEqual({ peerId: "ou_1", text: "BIND-ABCDE" });
  });
});

describe("dingtalk", () => {
  test("sign matches timestamp + secret", () => {
    const secret = "sec";
    const ts = "1710000000000";
    const sign = createHmac("sha256", secret).update(`${ts}\n${secret}`).digest("base64");
    expect(dingtalkSignOk(secret, ts, sign)).toBe(true);
    expect(dingtalkSignOk(secret, ts, "nope")).toBe(false);
  });

  test("parses text", () => {
    expect(dingtalkText({ senderStaffId: "u1", text: { content: " hello " } })).toEqual({
      peerId: "u1",
      text: "hello",
    });
  });
});
