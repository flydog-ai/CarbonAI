export type ModelInfo = {
  id: string;
  displayName: string;
};

/** Which client family is asking. Incoming `model` is still accepted as-is. */
export type ModelListPrefer = "anthropic" | "openai";

export function stripContextSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, "");
}

export function displayNameFor(model: string, aliases: Record<string, string>, fallback: string): string {
  const id = stripContextSuffix(model);
  return aliases[id] ?? aliases[model] ?? fallback;
}

function modelFamily(id: string): "anthropic" | "openai" | "other" {
  const n = stripContextSuffix(id).toLowerCase();
  if (n.startsWith("claude") || n.startsWith("anthropic")) return "anthropic";
  if (n.startsWith("gpt-") || n.startsWith("o1") || n.startsWith("o3") || n.startsWith("o4")) return "openai";
  return "other";
}

function familyRank(id: string, prefer: ModelListPrefer): number {
  const family = modelFamily(id);
  if (family === prefer) return 0;
  if (family === "other") return 1;
  return 2;
}

function withinFamilyRank(id: string): number {
  const n = stripContextSuffix(id).toLowerCase();
  if (n.includes("fable")) return 0;
  if (n.includes("opus")) return 1;
  if (n.includes("sonnet")) return 2;
  if (n.includes("haiku")) return 3;
  return 10;
}

export function listModels(opts: {
  defaultId: string;
  defaultDisplay: string;
  aliases: Record<string, string>;
  prefer?: ModelListPrefer;
}): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  const add = (id: string, displayName: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, displayName });
  };
  add(opts.defaultId, opts.defaultDisplay);
  for (const [id, displayName] of Object.entries(opts.aliases)) {
    add(id, displayName || opts.defaultDisplay);
  }
  if (!opts.prefer) return out;
  const prefer = opts.prefer;
  return out
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const family = familyRank(a.model.id, prefer) - familyRank(b.model.id, prefer);
      if (family !== 0) return family;
      const within = withinFamilyRank(a.model.id) - withinFamilyRank(b.model.id);
      if (within !== 0) return within;
      return a.index - b.index;
    })
    .map((row) => row.model);
}

/** Prefer claude-* alias ids so Claude Code's local recognizer is quiet. Default slot is latest fable when listed. */
export function claudeModelSlots(opts: {
  defaultId: string;
  aliases: Record<string, string>;
}): { model: string; haikuModel: string; sonnetModel: string; opusModel: string } {
  const ids = Object.keys(opts.aliases);
  const claudeIds = ids.filter((id) => id.startsWith("claude-"));
  const pick = (hint: string): string | undefined =>
    claudeIds.find((id) => id.toLowerCase().includes(hint));
  const claude = claudeIds[0] ?? opts.defaultId;
  const fable = pick("fable");
  const haiku = pick("haiku") ?? claude;
  const sonnet = pick("sonnet") ?? fable ?? claude;
  const opus = pick("opus") ?? fable ?? claude;
  return {
    model: fable ?? sonnet,
    haikuModel: haiku,
    sonnetModel: sonnet,
    opusModel: opus,
  };
}
