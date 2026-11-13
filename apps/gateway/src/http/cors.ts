import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Config } from "@carbon-ai/config";

const MODEL_API = /^\/(?:v1(?:\/|$)|messages(?:\/|$)|chat\/completions$|responses(?:\/|$)|models(?:\/|$))/;

/** Model API routes authenticate with a client key, never a cookie, so they are the only ones opened cross-origin. */
export function isModelApiPath(path: string): boolean {
  return MODEL_API.test(path);
}

/** Empty list or `"*"` means any origin. */
export function corsOrigin(origins: readonly string[]): string | string[] {
  if (origins.length === 0 || origins.includes("*")) return "*";
  return [...origins];
}

/**
 * Browser access to the model API when `[cors] enabled = true`.
 * No credentials: a third-party page can bring a client key, never the operator's console cookie.
 * Request headers are reflected so vendor SDKs (x-stainless-*, anthropic-*, openai-*) pass preflight.
 * Mount before the access log so preflights do not flood it.
 */
export function modelApiCors(cfg: Config): MiddlewareHandler | undefined {
  if (!cfg.cors.enabled) return undefined;
  const handle = cors({
    origin: corsOrigin(cfg.cors.origins),
    allowMethods: ["GET", "HEAD", "POST", "DELETE"],
    maxAge: 86400,
  });
  return (c, next) => (isModelApiPath(c.req.path) ? handle(c, next) : next());
}
