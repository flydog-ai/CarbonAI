import type { Config } from "@carbon-ai/config";

/** CC Switch rejects provider import when apiKey is empty. */
export const LOCAL_API_KEY = "sk-carbon-local";

export type CcSwitchClaudeImport = {
  name: string;
  endpoint: string;
  apiKey: string;
  homepage?: string;
  model: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  notes?: string;
};

/** Prefer 127.0.0.1 so the import matches README client config. */
export function preferLoopbackOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

export function guestApiKeyFromToml(cfg: Config): string | undefined {
  const key = cfg.auth.apiKeys.find((k) => k.key.trim())?.key.trim();
  return key || undefined;
}

/** Toml guest key, or local fallback when no user database is attached. */
export function clientApiKey(cfg: Config, hasUserDirectory = false): string | undefined {
  const guest = guestApiKeyFromToml(cfg);
  if (guest) return guest;
  if (hasUserDirectory) return undefined;
  return LOCAL_API_KEY;
}

/**
 * CC Switch v1 deep link for a Claude Code provider.
 * endpoint is the site origin — no /v1.
 * @see https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/5-faq/5.3-deeplink.md
 */
export function buildCcSwitchClaudeImportHref(opts: CcSwitchClaudeImport): string {
  const params = new URLSearchParams();
  params.set("resource", "provider");
  params.set("app", "claude");
  params.set("name", opts.name);
  params.set("endpoint", opts.endpoint);
  params.set("apiKey", opts.apiKey);
  params.set("homepage", opts.homepage ?? opts.endpoint);
  params.set("model", opts.model);
  params.set("haikuModel", opts.haikuModel ?? opts.model);
  params.set("sonnetModel", opts.sonnetModel ?? opts.model);
  params.set("opusModel", opts.opusModel ?? opts.model);
  if (opts.notes) params.set("notes", opts.notes);
  params.set("enabled", "true");
  return `ccswitch://v1/import?${params.toString()}`;
}
