import { useEffect, useRef } from "react";
import {
  emptyValue,
  hydrateToolValues,
  inferWidget,
  initialAssembled,
  serializeToolValues,
  type ToolInputMode,
  type ToolParam as ProtoParam,
} from "@carbon-ai/protocol/tool-draft";
import type { PublicTool, ToolParam } from "./types.ts";

export type PendingTool = {
  id: string;
  name: string;
  kind: string;
  input: string;
  required: string[];
  params: ToolParam[];
  description?: string;
  inputMode: ToolInputMode;
  assembled: string[];
  values: Record<string, unknown>;
  raw: boolean;
};

type TFn = (k: string, v?: Record<string, string | number>) => string;

function asProto(params: ToolParam[]): ProtoParam[] {
  return params.map((p) => ({
    key: p.key,
    type: p.type,
    required: p.required,
    description: p.description,
    enumValues: p.enumValues,
    minimum: p.minimum,
    maximum: p.maximum,
    widget: p.widget ?? inferWidget({ key: p.key, type: p.type, enumValues: p.enumValues }),
  }));
}

function syncInput(next: PendingTool): PendingTool {
  const params = asProto(next.params);
  return {
    ...next,
    input: serializeToolValues(next.inputMode, params, next.assembled, next.values),
  };
}

export function pendingFromTool(tool: PublicTool): Omit<PendingTool, "id"> {
  const params = tool.params ?? [];
  const proto = asProto(params);
  const assembled = initialAssembled(proto);
  const values: Record<string, unknown> = {};
  for (const key of assembled) {
    const p = proto.find((item) => item.key === key);
    if (p) values[key] = emptyValue(p);
  }
  const draft: PendingTool = {
    id: "",
    name: tool.name,
    kind: tool.kind,
    input: "",
    required: tool.required,
    params,
    description: tool.description,
    inputMode: tool.inputMode,
    assembled,
    values,
    raw: false,
  };
  return syncInput(draft);
}

export function ToolDraftCard({
  draft,
  onChange,
  onRemove,
  t,
}: {
  draft: PendingTool;
  onChange: (next: PendingTool) => void;
  onRemove: () => void;
  t: TFn;
}) {
  const focusKey = useRef<string | null>(null);
  const proto = asProto(draft.params);
  const unused = proto.filter((p) => !draft.assembled.includes(p.key));

  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    document.getElementById(`tf-${draft.id}-${key}`)?.focus();
  }, [draft.assembled, draft.id]);

  function patch(partial: Partial<PendingTool>): void {
    onChange(syncInput({ ...draft, ...partial }));
  }

  function setValue(key: string, value: unknown): void {
    patch({ values: { ...draft.values, [key]: value } });
  }

  function assemble(key: string): void {
    if (draft.assembled.includes(key)) return;
    const p = proto.find((item) => item.key === key);
    focusKey.current = key;
    patch({
      assembled: [...draft.assembled, key],
      values: { ...draft.values, [key]: p ? emptyValue(p) : "" },
    });
  }

  function drop(key: string): void {
    const p = proto.find((item) => item.key === key);
    if (p?.required) return;
    const { [key]: _removed, ...rest } = draft.values;
    patch({ assembled: draft.assembled.filter((k) => k !== key), values: rest });
  }

  return (
    <div className="tool-draft">
      <div className="tool-draft-head">
        <div>
          <b>{draft.name}</b>
          {draft.description ? <span className="tool-draft-desc"> · {draft.description}</span> : null}
        </div>
        <div className="tool-draft-actions">
          <button
            type="button"
            className={`btn btn-ghost btn-sm${draft.raw ? " on" : ""}`}
            onClick={() => {
              if (draft.raw) {
                const hydrated = hydrateToolValues(draft.inputMode, proto, draft.input);
                onChange(syncInput({ ...draft, raw: false, ...hydrated }));
                return;
              }
              patch({ raw: true });
            }}
          >
            {draft.raw ? t("desk.formFields") : t("desk.formJson")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            {t("desk.toolRemove")}
          </button>
        </div>
      </div>

      {draft.raw ? (
        <textarea
          value={draft.input}
          spellCheck={false}
          onChange={(e) => onChange({ ...draft, input: e.target.value, raw: true })}
        />
      ) : (
        <>
          {unused.length ? (
            <div className="tf-add">
              <span>{t("desk.paramAdd")}</span>
              {unused.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="tf-chip"
                  title={p.description || p.type}
                  onClick={() => assemble(p.key)}
                >
                  + {p.key}
                  <em>{p.type}</em>
                </button>
              ))}
            </div>
          ) : null}
          {draft.assembled.map((key) => {
            const p = proto.find((item) => item.key === key);
            if (!p) return null;
            return (
              <Field
                key={key}
                id={`tf-${draft.id}-${key}`}
                param={p}
                value={draft.values[key]}
                t={t}
                onChange={(v) => setValue(key, v)}
                onRemove={p.required ? undefined : () => drop(key)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

function Field({
  id,
  param,
  value,
  t,
  onChange,
  onRemove,
}: {
  id: string;
  param: ProtoParam;
  value: unknown;
  t: TFn;
  onChange: (value: unknown) => void;
  onRemove?: () => void;
}) {
  const bounds = [param.minimum != null ? `min ${param.minimum}` : "", param.maximum != null ? `max ${param.maximum}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="tf-field">
      <div className="tf-label">
        <code>{param.key}</code>
        <span className="tf-type">{param.type}</span>
        {param.required ? <em>{t("desk.paramRequired")}</em> : null}
        {onRemove ? (
          <button type="button" className="tf-drop" onClick={onRemove} aria-label={t("desk.paramDrop")}>
            ×
          </button>
        ) : null}
      </div>
      {param.description ? <p className="tf-hint">{param.description}</p> : null}
      {bounds ? <p className="tf-hint">{bounds}</p> : null}
      <Widget id={id} param={param} value={value} t={t} onChange={onChange} />
    </div>
  );
}

function Widget({
  id,
  param,
  value,
  t,
  onChange,
}: {
  id: string;
  param: ProtoParam;
  value: unknown;
  t: TFn;
  onChange: (value: unknown) => void;
}) {
  switch (param.widget) {
    case "boolean":
      return (
        <button
          type="button"
          id={id}
          className={`switch${value === true ? " on" : ""}`}
          aria-pressed={value === true}
          onClick={() => onChange(value !== true)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          value={value === "" || value == null ? "" : String(value)}
          min={param.minimum}
          max={param.maximum}
          step={param.type === "integer" ? 1 : "any"}
          onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value)}
        />
      );
    case "enum":
      return (
        <div className="tf-enum" id={id}>
          {(param.enumValues ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              className={String(value) === opt ? "on" : ""}
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    case "list": {
      const items = Array.isArray(value) ? value.map((x) => String(x)) : [""];
      return (
        <div className="tf-list">
          {items.map((item, i) => (
            <div key={i} className="tf-list-row">
              <input
                id={i === 0 ? id : undefined}
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...items, ""])}>
            {t("desk.listAdd")}
          </button>
        </div>
      );
    }
    case "kv": {
      const rows = Array.isArray(value)
        ? (value as { k?: string; v?: string }[]).map((r) => ({ k: r.k ?? "", v: r.v ?? "" }))
        : [];
      return (
        <div className="tf-list">
          {rows.map((row, i) => (
            <div key={i} className="tf-list-row kv">
              <input
                id={i === 0 ? id : undefined}
                placeholder={t("desk.kvKey")}
                value={row.k}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, k: e.target.value };
                  onChange(next);
                }}
              />
              <input
                placeholder={t("desk.kvValue")}
                value={row.v}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { ...row, v: e.target.value };
                  onChange(next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onChange([...rows, { k: "", v: "" }])}
          >
            {t("desk.kvAdd")}
          </button>
        </div>
      );
    }
    case "json":
    case "textarea":
      return (
        <textarea
          id={id}
          value={String(value ?? "")}
          spellCheck={false}
          className={param.widget === "json" ? "tf-json" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          id={id}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
