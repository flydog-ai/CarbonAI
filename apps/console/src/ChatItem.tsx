import type { ContextBlock } from "./types.ts";

type TFn = (k: string, v?: Record<string, string | number>) => string;
type Field = { key: string; value: string };

function tagLabel(t: TFn, kind?: string): string {
  if (!kind || kind === "text") return "";
  const key = `tag.${kind}`;
  const label = t(key);
  return label !== key ? label : kind.replaceAll("_", " ").replaceAll("-", " ");
}

function parseJsonFields(excerpt: string): Field[] | undefined {
  const raw = excerpt.trim();
  if (!raw.startsWith("{")) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    return Object.entries(v as Record<string, unknown>).map(([key, val]) => ({
      key,
      value: typeof val === "string" ? val : val == null ? "" : String(val),
    }));
  } catch {
    return undefined;
  }
}

function fieldsOf(block: ContextBlock): Field[] {
  return block.fields?.length ? block.fields : parseJsonFields(block.excerpt) ?? [];
}

function pick(fields: Field[], keys: string[]): Field | undefined {
  const want = new Set(keys);
  return fields.find((f) => want.has(f.key));
}

function fileName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

function displayPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}

function formatTokenField(value: string): string {
  const m = /^(\d+)\s*(.*)$/.exec(value.trim());
  if (!m) return value;
  const n = Number(m[1]);
  const rest = m[2] ?? "";
  return `${n.toLocaleString("en-US")}${rest ? ` ${rest}` : ""}`;
}

function BlockKv({ fields, hide }: { fields: Field[]; hide?: Set<string> }) {
  const rows = hide ? fields.filter((f) => !hide.has(f.key)) : fields;
  if (!rows.length) return null;
  return (
    <dl className="kv">
      {rows.map((row, i) => (
        <div key={`${row.key}-${i}`} className="kv-row">
          {row.key ? <dt>{row.key}</dt> : null}
          <dd>{row.value === "" ? "∅" : row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function emptyLabel(t: TFn, value: string): string {
  return value === "" ? t("desk.emptyValue") : value;
}

function ToolCallBody({ block, t }: { block: ContextBlock; t: TFn }) {
  const fields = fieldsOf(block);
  const path = pick(fields, ["file_path", "path"])?.value;
  const oldS = pick(fields, ["old_string"]);
  const newS = pick(fields, ["new_string"]);
  const cmd = pick(fields, ["command", "commands"])?.value;
  const diff = pick(fields, ["diff"])?.value;
  const hide = new Set(
    ["file_path", "path", "old_string", "new_string", "command", "commands", "diff"].filter((k) =>
      fields.some((f) => f.key === k),
    ),
  );
  const hasDiff = oldS !== undefined || newS !== undefined || Boolean(diff);

  return (
    <div className="event-body">
      {path ? (
        <p className="event-file" title={path}>
          {displayPath(path)}
        </p>
      ) : null}
      {cmd ? <pre className="event-code">{cmd}</pre> : null}
      {hasDiff ? (
        <div className="mini-diff">
          {oldS !== undefined ? (
            <pre className="del" data-label={t("desk.diffOld")}>
              {emptyLabel(t, oldS.value)}
            </pre>
          ) : null}
          {newS !== undefined ? (
            <pre className="add" data-label={t("desk.diffNew")}>
              {emptyLabel(t, newS.value)}
            </pre>
          ) : null}
          {diff ? <pre className="event-code">{diff}</pre> : null}
        </div>
      ) : null}
      <BlockKv fields={fields} hide={hide} />
      {!fields.length ? (
        <pre>
          {block.excerpt}
          {block.truncated ? "…" : ""}
        </pre>
      ) : null}
    </div>
  );
}

function splitResultNote(text: string): { main: string; note?: string } {
  const m = /^(.*?)(?:\s*\((note:|file state)[^)]*\))\s*$/is.exec(text.trim());
  if (m?.[1]) return { main: m[1].trim(), note: text.slice(m[1].length).trim() };
  return { main: text };
}

function ToolResultBody({ block, t }: { block: ContextBlock; t: TFn }) {
  const raw = block.excerpt;
  const { note } = splitResultNote(raw);
  const notFound = /string to replace not found/i.test(raw);
  const stringLine = /^\s*String:\s*(.*)$/im.exec(raw);
  if (notFound) {
    return (
      <div className="event-body">
        <p className="event-lead">{t("desk.replaceMiss")}</p>
        {stringLine?.[1] ? <pre className="event-quote">{stringLine[1]}</pre> : null}
      </div>
    );
  }
  const success = /updated successfully|has been updated|written successfully/i.test(raw);
  if (success) {
    const path = /(?:The file |Updated )(.+?)(?: has been updated| successfully)/i.exec(raw)?.[1];
    return (
      <div className="event-body">
        <p className="event-lead">{t("desk.toolOkHint")}</p>
        {path ? (
          <p className="event-file" title={path}>
            {displayPath(path)}
          </p>
        ) : null}
        {note ? <p className="event-note">{note}</p> : null}
      </div>
    );
  }
  return (
    <div className="event-body">
      <pre>
        {block.excerpt}
        {block.truncated ? "…" : ""}
      </pre>
    </div>
  );
}

function ReminderBody({ block }: { block: ContextBlock }) {
  const other = block.fields?.filter((f) => !/token/i.test(f.key)) ?? [];
  return (
    <div className="event-body">
      {other.length ? <BlockKv fields={other} /> : null}
      {block.excerpt.trim() ? (
        <p className="event-prose">
          {block.excerpt}
          {block.truncated ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}

function BlockBody({ block }: { block: ContextBlock }) {
  if (block.fields?.length) {
    return (
      <dl className="kv">
        {block.fields.map((row, i) => (
          <div key={i} className="kv-row">
            {row.key ? <dt>{row.key}</dt> : null}
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <pre>
      {block.excerpt}
      {block.truncated ? "…" : ""}
    </pre>
  );
}

export function ChatItem({ block, t }: { block: ContextBlock; t: TFn }) {
  const lane = block.lane || (block.role === "assistant" ? "assistant" : block.role === "user" ? "user" : "system");
  const mine = lane === "assistant" || block.source === "reply";
  const extra = block.truncated ? ` · ${t("desk.truncated")}` : "";

  if (block.kind === "tool_use") {
    const fields = fieldsOf(block);
    const path = pick(fields, ["file_path", "path"])?.value;
    return (
      <article className={`msg event tool-call${block.collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="event-head"
          onClick={(e) => e.currentTarget.parentElement?.classList.toggle("collapsed")}
        >
          <span className="event-kind">{t("tag.tool_use")}</span>
          <span className="event-name">{block.title || "tool"}</span>
          {path ? (
            <span className="event-path" title={path}>
              {fileName(path)}
            </span>
          ) : null}
          {extra ? <span className="event-extra">{extra}</span> : null}
        </button>
        <ToolCallBody block={block} t={t} />
      </article>
    );
  }

  if (block.kind === "tool_result") {
    const bad = block.status === "error";
    return (
      <article className={`msg event tool-result ${bad ? "is-error" : "is-ok"}${block.collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="event-head"
          onClick={(e) => e.currentTarget.parentElement?.classList.toggle("collapsed")}
        >
          <span className={`event-dot ${bad ? "err" : "ok"}`} />
          <span className="event-kind">{bad ? t("desk.toolFail") : t("desk.toolOk")}</span>
          {extra ? <span className="event-extra">{extra}</span> : null}
        </button>
        <ToolResultBody block={block} t={t} />
      </article>
    );
  }

  if (block.kind === "system-reminder") {
    const token = block.fields?.find((f) => /token/i.test(f.key));
    return (
      <article className={`msg event reminder${block.collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="event-head"
          onClick={(e) => e.currentTarget.parentElement?.classList.toggle("collapsed")}
        >
          <span className="event-kind">{t("tag.system-reminder")}</span>
          {token ? <span className="token-chip sm">{formatTokenField(token.value)}</span> : null}
          {extra ? <span className="event-extra">{extra}</span> : null}
        </button>
        <ReminderBody block={block} />
      </article>
    );
  }

  if (lane === "system" || lane === "meta" || lane === "tool") {
    const rawKind = block.title || (block.kind && block.kind !== "text" ? block.kind : undefined);
    const title =
      tagLabel(t, rawKind) || (t(`blk.${block.role}`) !== `blk.${block.role}` ? t(`blk.${block.role}`) : block.role);
    return (
      <article className={`msg meta lane-${lane}${block.collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="msg-head"
          onClick={(e) => e.currentTarget.parentElement?.classList.toggle("collapsed")}
        >
          {title}
          {extra}
        </button>
        <BlockBody block={block} />
      </article>
    );
  }

  const rawKind = block.title || (block.kind && block.kind !== "text" ? block.kind : undefined);
  const kindTitle = tagLabel(t, rawKind);
  return (
    <article className={`msg ${lane}${mine ? " you" : ""}`}>
      {kindTitle ? (
        <div className="msg-kind">
          {kindTitle}
          {extra}
        </div>
      ) : extra ? (
        <div className="msg-kind">{t("desk.truncated")}</div>
      ) : null}
      <BlockBody block={block} />
    </article>
  );
}
