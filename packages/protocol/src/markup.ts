export type MarkupSegment = {
  kind: "text" | "tag";
  name?: string;
  attrs: Record<string, string>;
  text: string;
};

const META_TAGS = new Set([
  "system-reminder",
  "env",
  "user_info",
  "user-info",
  "git-status",
  "gitstatus",
  "claude_background_info",
  "claude-background-info",
  "command-name",
  "command-message",
  "command-args",
  "local-command-caveat",
  "bash-input",
  "bash-stdout",
  "bash-stderr",
  "local-command-stdout",
  "local-command-stderr",
  "task-notification",
  "ide_opened_file",
  "ide-opened-file",
  "ide_selection",
  "ide-selection",
  "tick",
]);

const OPEN = /^<([A-Za-z][\w:-]*)(\s[^>]*)?\s*\/?>/;

export function isMetaTag(name: string): boolean {
  return META_TAGS.has(name.toLowerCase());
}

export function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]!] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/** Split text on top-level angle tags used by coding agents (Claude Code, etc.). */
export function splitMarkup(input: string): MarkupSegment[] {
  const segments: MarkupSegment[] = [];
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf) {
      segments.push({ kind: "text", attrs: {}, text: buf });
      buf = "";
    }
  };
  while (i < input.length) {
    if (input[i] !== "<") {
      buf += input[i];
      i += 1;
      continue;
    }
    const rest = input.slice(i);
    const self = rest.match(/^<([A-Za-z][\w:-]*)(\s[^>]*)?\s*\/>/);
    if (self) {
      flush();
      segments.push({ kind: "tag", name: self[1], attrs: parseAttrs(self[2] ?? ""), text: "" });
      i += self[0].length;
      continue;
    }
    const open = rest.match(OPEN);
    if (!open || rest.startsWith("</")) {
      buf += input[i];
      i += 1;
      continue;
    }
    const name = open[1]!;
    if (open[0].endsWith("/>")) {
      flush();
      segments.push({ kind: "tag", name, attrs: parseAttrs(open[2] ?? ""), text: "" });
      i += open[0].length;
      continue;
    }
    const innerStart = i + open[0].length;
    const closeToken = `</${name}`;
    const closeAt = input.indexOf(closeToken, innerStart);
    if (closeAt < 0) {
      buf += input[i];
      i += 1;
      continue;
    }
    const gt = input.indexOf(">", closeAt);
    if (gt < 0) {
      buf += input[i];
      i += 1;
      continue;
    }
    flush();
    segments.push({
      kind: "tag",
      name,
      attrs: parseAttrs(open[2] ?? ""),
      text: input.slice(innerStart, closeAt),
    });
    i = gt + 1;
  }
  flush();
  return segments;
}

export function parseEnvPairs(text: string): { key: string; value: string }[] {
  const pairs: { key: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cut = trimmed.indexOf(": ");
    if (cut > 0 && cut < 80) {
      pairs.push({ key: trimmed.slice(0, cut), value: trimmed.slice(cut + 2) });
    } else {
      pairs.push({ key: "", value: trimmed });
    }
  }
  return pairs;
}
