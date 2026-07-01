import { describe, expect, test } from "bun:test";
import { claudeModelSlots, listModels, stripContextSuffix } from "./models.ts";

describe("models catalog", () => {
  test("lists default plus aliases", () => {
    const list = listModels({
      defaultId: "carbon-default",
      defaultDisplay: "Carbon AI",
      aliases: { "claude-sonnet-4-6": "You (Sonnet slot)" },
    });
    expect(list.map((m) => m.id)).toEqual(["carbon-default", "claude-sonnet-4-6"]);
  });

  test("prefers claude-* slots", () => {
    const slots = claudeModelSlots({
      defaultId: "carbon-default",
      aliases: {
        "claude-opus-4-6": "You (Opus slot)",
        "claude-sonnet-4-6": "You (Sonnet slot)",
        "claude-haiku-4-5": "You (Haiku slot)",
      },
    });
    expect(slots.model).toBe("claude-sonnet-4-6");
    expect(slots.haikuModel).toBe("claude-haiku-4-5");
    expect(slots.opusModel).toBe("claude-opus-4-6");
    expect(stripContextSuffix("claude-sonnet-4-6[1m]")).toBe("claude-sonnet-4-6");
  });
});
