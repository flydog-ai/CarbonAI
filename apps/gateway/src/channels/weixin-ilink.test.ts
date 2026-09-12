import { describe, expect, test } from "bun:test";
import { fetchBotQr, pollQrStatus, textFromIlink } from "./weixin-ilink.ts";

describe("weixin ilink client", () => {
  test("fetchBotQr posts get_bot_qrcode", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toContain("/ilink/bot/get_bot_qrcode");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ qrcode: "abc", qrcode_img_content: "https://qr.example/x" }), {
        headers: { "content-type": "application/json" },
      });
    };
    const qr = await fetchBotQr(fetchImpl);
    expect(qr.qrcode).toBe("abc");
    expect(qr.qrcodeUrl).toBe("https://qr.example/x");
  });

  test("pollQrStatus maps timeout to wait", async () => {
    const fetchImpl: typeof fetch = async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    };
    const st = await pollQrStatus(fetchImpl, "abc");
    expect(st.status).toBe("wait");
  });

  test("textFromIlink joins text items", () => {
    expect(
      textFromIlink({
        item_list: [
          { type: 1, text_item: { text: "hello" } },
          { type: 2 },
          { type: 1, text_item: { text: "world" } },
        ],
      }),
    ).toBe("hello\nworld");
  });
});
