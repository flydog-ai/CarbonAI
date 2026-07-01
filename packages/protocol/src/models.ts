export type ModelInfo = {
  id: string;
  displayName: string;
};

export function stripContextSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, "");
}

export function displayNameFor(model: string, aliases: Record<string, string>, fallback: string): string {
  const id = stripContextSuffix(model);
  return aliases[id] ?? aliases[model] ?? fallback;
}

export function listModels(opts: {
  defaultId: string;
  defaultDisplay: string;
  aliases: Record<string, string>;
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
  return out;
}

/** Prefer claude-* alias ids so Claude Code's local recognizer is quiet. */
export function claudeModelSlots(opts: {
  defaultId: string;
  aliases: Record<string, string>;
}): { model: string; haikuModel: string; sonnetModel: string; opusModel: string } {
  const ids = Object.keys(opts.aliases);
  const pick = (hint: string, fallback: string): string =>
    ids.find((id) => id.toLowerCase().includes(hint)) ?? fallback;
  const claude = ids.find((id) => id.startsWith("claude-")) ?? opts.defaultId;
  const haiku = pick("haiku", claude);
  const sonnet = pick("sonnet", claude);
  const opus = pick("opus", claude);
  return { model: sonnet, haikuModel: haiku, sonnetModel: sonnet, opusModel: opus };
}
