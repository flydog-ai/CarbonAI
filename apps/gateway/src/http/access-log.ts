import type { Context, Next } from "hono";

export type AccessLogWrite = (line: string) => void;

function skipGet(path: string): boolean {
  if (path === "/" || path === "/favicon.svg" || path === "/health" || path === "/ready") return true;
  if (path.startsWith("/console") || path.startsWith("/assets") || path.startsWith("/ui")) return true;
  if (path.startsWith("/debug")) return true;
  if (path.startsWith("/api/") && !path.startsWith("/api/hello")) return true;
  return false;
}

function shouldLog(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  if (path.startsWith("/v1")) return true;
  if (/chat\/completions|\/completions|\/responses|\/models|\/messages/.test(path)) return true;
  return !skipGet(path);
}

function authKind(c: Context): string {
  if (c.req.header("authorization")) return "bearer";
  if (c.req.header("x-api-key")) return "x-api-key";
  return "none";
}

async function errorSnippet(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return "";
  try {
    const body = (await res.clone().json()) as {
      error?: { message?: unknown; type?: unknown } | string;
      message?: unknown;
    };
    const err = body.error;
    if (typeof err === "string") return err.slice(0, 200);
    if (err && typeof err === "object") {
      const msg = typeof err.message === "string" ? err.message : "";
      const type = typeof err.type === "string" ? err.type : "";
      return [type, msg].filter(Boolean).join(" ").slice(0, 200);
    }
    if (typeof body.message === "string") return body.message.slice(0, 200);
  } catch {
    /* not json */
  }
  return "";
}

export function accessLog(opts: { write?: AccessLogWrite } = {}) {
  const write = opts.write ?? ((line: string) => console.log(line));
  return async (c: Context, next: Next): Promise<void> => {
    const url = new URL(c.req.url);
    const path = url.pathname + url.search;
    const method = c.req.method;
    if (!shouldLog(method, url.pathname)) {
      await next();
      return;
    }
    const ua = (c.req.header("user-agent") ?? "").slice(0, 80);
    const host = c.req.header("host") ?? url.host;
    write(`http ← ${method} ${path} host=${host} auth=${authKind(c)} ua=${JSON.stringify(ua)}`);
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const status = c.res.status;
      const ms = Date.now() - t0;
      let extra = "";
      if (status >= 400) extra = await errorSnippet(c.res);
      write(`http → ${method} ${path} ${status} ${ms}ms${extra ? ` ${extra}` : ""}`);
    }
  };
}
