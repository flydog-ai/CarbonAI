import type { CarbonDb } from "@carbon-ai/db";
import { CALLER_RECENT_MS, presenceOf, type Presence } from "../auth/sight.ts";
import { clientKindLabel } from "../auth/visitors.ts";
import type { JobEngine, JobSummary } from "../job/engine.ts";

const LIVE = new Set(["pending", "claimed", "streaming"]);

export type CallerView = {
  id: string;
  kind: "user" | "guest";
  label: string;
  clientKind?: string;
  clientKindLabel?: string;
  clientIp?: string;
  keyPrefix?: string;
  lastSeenAt: number;
  presence: Presence;
  liveJobs: number;
};

function isLive(status: string): boolean {
  return LIVE.has(status);
}

export function decorateJobs(db: CarbonDb, jobs: JobSummary[], now = Date.now()): JobSummary[] {
  const visitorIds = jobs.map((j) => j.visitorId).filter((id): id is string => Boolean(id));
  const visitors = new Map(db.visitors.getMany(visitorIds).map((v) => [v.id, v]));
  const userIds = [...new Set(jobs.map((j) => j.userId).filter((id): id is string => Boolean(id)))];
  const users = new Map(userIds.map((id) => [id, db.users.getById(id)]));

  return jobs.map((job) => {
    const visitor = job.visitorId ? visitors.get(job.visitorId) : undefined;
    const user = job.userId ? users.get(job.userId) : undefined;
    const lastSeenAt = visitor?.last_seen_at ?? user?.last_seen_at ?? undefined;
    const clientKind = job.clientKind ?? visitor?.last_client ?? undefined;
    return {
      ...job,
      callerLabel: job.callerLabel || visitor?.short_id || user?.username || job.clientLabel,
      clientKind,
      clientIp: job.clientIp ?? visitor?.ip ?? undefined,
      lastSeenAt,
      presence: presenceOf({ live: isLive(job.status), lastSeenAt, now }),
      keyPrefix: job.keyPrefix ?? visitor?.last_key_prefix ?? visitor?.key_prefix ?? undefined,
    };
  });
}

export function listCallers(
  db: CarbonDb,
  engine: JobEngine,
  now = Date.now(),
  ownerId?: string,
  siteDeskId?: string,
): CallerView[] {
  const jobs = ownerId
    ? engine.list().filter((j) => (j.ownerId ?? siteDeskId) === ownerId)
    : engine.list();
  const live = jobs.filter((j) => isLive(j.status));
  const liveByVisitor = new Map<string, number>();
  const liveByUser = new Map<string, number>();
  for (const j of live) {
    if (j.visitorId) liveByVisitor.set(j.visitorId, (liveByVisitor.get(j.visitorId) ?? 0) + 1);
    if (j.userId) liveByUser.set(j.userId, (liveByUser.get(j.userId) ?? 0) + 1);
  }

  const since = now - CALLER_RECENT_MS;
  const byId = new Map<string, CallerView>();
  const ownedVisitors = new Set(jobs.map((j) => j.visitorId).filter((id): id is string => Boolean(id)));

  for (const v of db.visitors.listRecent(since, 80)) {
    if (ownerId && !ownedVisitors.has(v.id) && !liveByVisitor.has(v.id)) continue;
    const liveJobs = liveByVisitor.get(v.id) ?? 0;
    byId.set(v.id, {
      id: v.id,
      kind: "guest",
      label: v.short_id,
      clientKind: v.last_client ?? undefined,
      clientKindLabel: clientKindLabel(v.last_client ?? undefined),
      clientIp: v.ip ?? undefined,
      keyPrefix: v.last_key_prefix ?? v.key_prefix ?? undefined,
      lastSeenAt: v.last_seen_at,
      presence: presenceOf({ live: liveJobs > 0, lastSeenAt: v.last_seen_at, now }),
      liveJobs,
    });
  }

  for (const u of db.users.listSeenSince(since, 80)) {
    if (!u.last_seen_at) continue;
    if (ownerId) continue;
    const liveJobs = liveByUser.get(u.id) ?? 0;
    const latest = jobs.find((j) => j.userId === u.id);
    byId.set(u.id, {
      id: u.id,
      kind: "user",
      label: u.username,
      clientKind: latest?.clientKind,
      clientKindLabel: clientKindLabel(latest?.clientKind),
      clientIp: latest?.clientIp,
      lastSeenAt: u.last_seen_at,
      presence: presenceOf({ live: liveJobs > 0, lastSeenAt: u.last_seen_at, now }),
      liveJobs,
    });
  }

  for (const j of live) {
    if (j.visitorId && !byId.has(j.visitorId)) {
      const v = db.visitors.getById(j.visitorId);
      if (!v) continue;
      byId.set(v.id, {
        id: v.id,
        kind: "guest",
        label: v.short_id,
        clientKind: j.clientKind ?? v.last_client ?? undefined,
        clientKindLabel: clientKindLabel(j.clientKind ?? v.last_client ?? undefined),
        clientIp: j.clientIp ?? v.ip ?? undefined,
        keyPrefix: v.last_key_prefix ?? v.key_prefix ?? undefined,
        lastSeenAt: v.last_seen_at,
        presence: "live",
        liveJobs: liveByVisitor.get(v.id) ?? 1,
      });
    }
    if (j.userId && j.userId !== ownerId && !byId.has(j.userId)) {
      const u = db.users.getById(j.userId);
      if (!u) continue;
      byId.set(u.id, {
        id: u.id,
        kind: "user",
        label: u.username,
        clientKind: j.clientKind,
        clientKindLabel: clientKindLabel(j.clientKind),
        clientIp: j.clientIp,
        lastSeenAt: u.last_seen_at ?? j.createdAt,
        presence: "live",
        liveJobs: liveByUser.get(u.id) ?? 1,
      });
    }
  }

  return [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
