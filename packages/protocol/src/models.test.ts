import { describe, expect, test } from "bun:test";
import { claudeModelSlots, listModels, stripContextSuffix } from "./models.ts";

const mixed = {
  "gpt-5": "Carbon AI (GPT slot)",
  "claude-sonnet-5": "Carbon AI (Sonnet slot)",
  "claude-fable-5-1": "Carbon AI (Fable slot)",
  "claude-opus-5": "Carbon AI (Opus slot)",
  "claude-haiku-4-5": "Carbon AI (Haiku slot)",
};

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

  test("Claude import default is latest fable when present", () => {
    const slots = claudeModelSlots({ defaultId: "carbon-default", aliases: mixed });
    expect(slots.model).toBe("claude-fable-5-1");
    expect(slots.opusModel).toBe("claude-opus-5");
    expect(slots.sonnetModel).toBe("claude-sonnet-5");
    expect(slots.haikuModel).toBe("claude-haiku-4-5");
  });

  test("Anthropic model list leads with fable, OpenAI list leads with gpt", () => {
    const base = {
      defaultId: "carbon-default",
      defaultDisplay: "Carbon AI",
      aliases: mixed,
    };
    expect(listModels({ ...base, prefer: "anthropic" }).map((m) => m.id)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "carbon-default",
      "gpt-5",
    ]);
    expect(listModels({ ...base, prefer: "openai" }).map((m) => m.id)).toEqual([
      "gpt-5",
      "carbon-default",
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });
});
