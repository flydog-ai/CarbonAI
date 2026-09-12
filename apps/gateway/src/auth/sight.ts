import { createHash } from "node:crypto";
import type { Context } from "hono";
import type { Config } from "@carbon-ai/config";
import type { Protocol } from "@carbon-ai/protocol";

export type ClientKind = "claude-code" | "codex" | "openai-chat" | "anthropic" | "browser" | "unknown";

export type RequestSight = {
  ip: string;
  userAgent: string;
  clientKind: ClientKind;
};

export type FetchEnv = {
  remoteAddress?: string;
};

export function canonicalIp(raw: string): string {
  let ip = raw.trim().replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

function firstHop(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hop = value.split(",")[0]?.trim();
  return hop || undefined;
}

export function requestIp(c: Context, cfg: Config): string {
  const env = c.env as FetchEnv | undefined;
  const remote = canonicalIp(env?.remoteAddress ?? "");
  if (cfg.server.host === "0.0.0.0") {
    const forwarded =
      firstHop(c.req.header("cf-connecting-ip") ?? undefined) ??
      firstHop(c.req.header("x-real-ip") ?? undefined) ??
      firstHop(c.req.header("x-forwarded-for") ?? undefined);
    if (forwarded) return canonicalIp(forwarded);
  }
  return remote || "127.0.0.1";
}

export function inferClientKind(input: { userAgent?: string; protocol?: Protocol }): ClientKind {
  const ua = (input.userAgent ?? "").toLowerCase();
  if (/claude-code|claude-cli|anthropic-ai\/claude/.test(ua)) return "claude-code";
  if (/\bcodex\b|openai-codex|codex_cli|codex-cli/.test(ua)) return "codex";
  if (/openai\/|openai-node|openai-python/.test(ua)) return "openai-chat";
  if (input.protocol === "openai_responses") return "codex";
  if (input.protocol === "anthropic_messages") return "claude-code";
  if (input.protocol === "openai_chat") return "openai-chat";
  if (/mozilla\/|chrome\/|safari\/|firefox\/|edg\//.test(ua)) return "browser";
  return "unknown";
}

export function requestSight(
  c: Context,
  cfg: Config,
  opts: { protocol?: Protocol } = {},
): RequestSight {
  const userAgent = (c.req.header("user-agent") ?? "").slice(0, 240);
  return {
    ip: requestIp(c, cfg),
    userAgent,
    clientKind: inferClientKind({ userAgent, protocol: opts.protocol }),
  };
}

export function visitorFingerprint(ip: string, userAgent: string): string {
  const ua = userAgent.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
  return createHash("sha256").update(`ip-ua|${canonicalIp(ip)}|${ua}`).digest("hex");
}

export const ONLINE_MS = 120_000;
export const CALLER_RECENT_MS = 24 * 60 * 60 * 1000;

export type Presence = "live" | "online" | "idle";

export function presenceOf(opts: { live: boolean; lastSeenAt?: number; now: number }): Presence {
  if (opts.live) return "live";
  if (opts.lastSeenAt && opts.now - opts.lastSeenAt <= ONLINE_MS) return "online";
  return "idle";
}
