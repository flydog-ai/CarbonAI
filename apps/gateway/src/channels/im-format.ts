import { clientKindLabel } from "../auth/visitors.ts";

export type ImCommand =
  | { type: "list" }
  | { type: "cancel" }
  | { type: "help" }
  | { type: "desk" }
  | { type: "reply"; index?: number; body: string }
  | { type: "unknown"; name: string };

const LIST = new Set(["list", "ls", "列表"]);
const CANCEL = new Set(["cancel", "取消"]);
const HELP = new Set(["help", "帮助", "?", "start", "helpme"]);
const DESK = new Set(["desk", "工作台", "console"]);

export type NotifyJob = {
  callerLabel?: string;
  clientKind?: string;
  lastUserPreview?: string;
  keyPrefix?: string;
  visitorId?: string;
};

export function parseImCommand(text: string): ImCommand {
  const raw = text.trim();
  if (!raw) return { type: "reply", body: "" };

  const slash = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(raw);
  if (slash) {
    const name = slash[1]!.toLowerCase();
    const rest = (slash[2] ?? "").trim();
    if (/^\d+$/.test(name)) return { type: "reply", index: Number(name) - 1, body: rest };
    if (LIST.has(name) || LIST.has(slash[1]!)) return { type: "list" };
    if (CANCEL.has(name) || CANCEL.has(slash[1]!)) return { type: "cancel" };
    if (HELP.has(name) || HELP.has(slash[1]!)) return { type: "help" };
    if (DESK.has(name) || DESK.has(slash[1]!)) return { type: "desk" };
    return { type: "unknown", name: slash[1]! };
  }

  const lower = raw.toLowerCase();
  if (LIST.has(raw) || LIST.has(lower)) return { type: "list" };
  if (CANCEL.has(raw) || CANCEL.has(lower)) return { type: "cancel" };
  if (HELP.has(raw) || HELP.has(lower)) return { type: "help" };
  if (DESK.has(raw) || DESK.has(lower)) return { type: "desk" };

  const numbered = /^(\d+)[\s.、:：]+([\s\S]+)$/.exec(raw);
  if (numbered) return { type: "reply", index: Number(numbered[1]) - 1, body: numbered[2]!.trim() };
  return { type: "reply", body: raw };
}

export function notifyCallerLine(job: NotifyJob): string {
  const kind = clientKindLabel(job.clientKind) || job.clientKind || "客户端";
  const who = job.callerLabel?.startsWith("G-")
    ? job.callerLabel
    : job.visitorId
      ? job.callerLabel
      : undefined;
  if (who) return `${kind} · ${who}`;
  return kind;
}

export function formatNotify(job: NotifyJob): string {
  const preview = (job.lastUserPreview || "").trim() || "(无文本)";
  return ["【新会话】", notifyCallerLine(job), preview, "", "直接回复即可作答", "多条发 /list"].join("\n");
}

export function formatHelp(): string {
  return [
    "在这里回复当前会话。",
    "/list  进行中的会话",
    "/1 内容  指定第 1 条",
    "/cancel  取消当前会话",
    "/desk  工作台链接（登录你自己的账号）",
    "/help  本说明",
  ].join("\n");
}

export function formatList(
  jobs: { callerLabel?: string; clientKind?: string; lastUserPreview?: string; visitorId?: string }[],
): string {
  if (jobs.length === 0) return "没有等待回复的会话。发 /help 看指令。";
  const lines = jobs.map((j, i) => {
    const preview = (j.lastUserPreview || "").trim().slice(0, 80) || "(无文本)";
    return `${i + 1}. ${notifyCallerLine(j)}\n${preview}`;
  });
  return `进行中 ${jobs.length} 条：\n${lines.join("\n\n")}\n\n回复 /1 内容 指定会话。`;
}

export function formatDeskLink(origin: string): string {
  const base = origin.replace(/\/$/, "");
  const url = base ? `${base}/console` : "/console";
  return `工作台（登录你自己的账号）：\n${url}`;
}
