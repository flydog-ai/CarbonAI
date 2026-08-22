import type { Job } from "./types.ts";

export function fmtWhen(ts: number | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("time.justNow");
  if (diff < 3_600_000) return t("time.mAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("time.hAgo", { n: Math.floor(diff / 3_600_000) });
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

export function isLive(j: Job): boolean {
  return j.status === "pending" || j.status === "claimed" || j.status === "streaming";
}

export function groupThreads(jobs: Job[]): Job[] {
  const map = new Map<string, Job[]>();
  for (const j of jobs) {
    const tid = j.threadId || j.id;
    const list = map.get(tid) ?? [];
    list.push(j);
    map.set(tid, list);
  }
  return [...map.values()].map((items) => {
    items.sort((a, b) => b.createdAt - a.createdAt);
    const live = items.filter(isLive);
    const latest = live[0] ?? items[0]!;
    return { ...latest, turnCount: Math.max(...items.map((i) => i.turnCount || 1)) };
  });
}

export function secretPrefix(plaintext: string): string {
  if (plaintext.length < 16) return plaintext;
  return `${plaintext.slice(0, 12)}…${plaintext.slice(-4)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function readView(): "home" | "desk" | "keys" | "users" | "settings" {
  const v = new URLSearchParams(location.search).get("view");
  if (v === "desk" || v === "keys" || v === "users" || v === "home" || v === "settings") return v;
  return "home";
}

export function setViewUrl(view: string): void {
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  url.hash = "";
  history.replaceState(null, "", url.pathname + url.search);
}
