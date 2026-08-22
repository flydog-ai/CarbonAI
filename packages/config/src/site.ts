import type { Config } from "./types.ts";

export const SETTINGS_KEYS = {
  name: "site.name",
  nameZh: "site.name_zh",
  publicOrigin: "site.public_origin",
  defaultDisplay: "models.default_display",
} as const;

export function applySettingsKv(cfg: Config, kv: Record<string, string>): void {
  const name = kv[SETTINGS_KEYS.name]?.trim();
  if (name) cfg.site.name = name;
  const nameZh = kv[SETTINGS_KEYS.nameZh]?.trim();
  if (nameZh) cfg.site.nameZh = nameZh;
  if (kv[SETTINGS_KEYS.publicOrigin] !== undefined) {
    cfg.site.publicOrigin = kv[SETTINGS_KEYS.publicOrigin].trim().replace(/\/$/, "");
  }
  const display = kv[SETTINGS_KEYS.defaultDisplay]?.trim();
  if (display) cfg.models.defaultDisplay = display;
}

export function normalizePublicOrigin(raw: string): string | { error: string } {
  const s = raw.trim().replace(/\/$/, "");
  if (!s) return "";
  try {
    const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { error: "origin must be http or https" };
    }
    return u.origin;
  } catch {
    return { error: "invalid origin" };
  }
}

export function publicSettings(cfg: Config): {
  name: string;
  nameZh: string;
  publicOrigin: string;
  defaultDisplay: string;
} {
  return {
    name: cfg.site.name,
    nameZh: cfg.site.nameZh,
    publicOrigin: cfg.site.publicOrigin,
    defaultDisplay: cfg.models.defaultDisplay,
  };
}
