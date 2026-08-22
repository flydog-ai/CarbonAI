import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "@carbon-ai/config";
import { RAW_INLINE_LIMIT, runRetention, type CarbonDb } from "@carbon-ai/db";
import {
  emptyNormalizedRequest,
  eventsFromBlocks,
  estimateRequestTokens,
  fold,
  ids,
  lastUserPreview,
  sha256Hex,
  toolNames,
  type AssistantBlock,
  type AssistantOutput,
  type CancelReason,
  type InternalEvent,
  type JobStatus,
  type NormalizedRequest,
  type Protocol,
  type ProtocolAdapter,
  type SseSink,
  type StopReason,
  type StreamCtx,
} from "@carbon-ai/protocol";
import { JobConflictError, JobNotFoundError, JobQueueFullError } from "./errors.ts";
import { TestAdapter } from "./test-adapter.ts";

export type CreateJobInput = {
  protocol: Protocol;
  model?: string;
  stream: boolean;
  rawBody: Uint8Array;
  headers: Record<string, string>;
  normalized?: NormalizedRequest;
  clientKeyId?: string;
  clientLabel?: string;
  userId?: string;
  adapter?: ProtocolAdapter;
};

export type JobSummary = {
  id: string;
  status: JobStatus;
  protocol: Protocol;
  model: string;
  displayModel: string;
  clientLabel: string;
  stream: boolean;
  createdAt: number;
  waitMs: number;
  inputTokensEst: number;
  toolNames: string[];
  lastUserPreview: string;
  requestHash: string;
  claimedBy?: string;
  looksLikeRetryOf?: string;
  userId?: string;
};

type TerminalState = { status: "completed" | "cancelled" | "failed"; error?: string };

type Runtime = {
  id: string;
  status: JobStatus;
  protocol: Protocol;
  model: string;
  displayModel: string;
  stream: boolean;
  createdAt: number;
  request: NormalizedRequest;
  vendorMessageId: string;
  events: InternalEvent[];
  requestHash: string;
  clientKeyId: string;
  clientLabel: string;
  inputTokens: number;
  outputTokens: number;
  claimedBy?: string;
  claimedAt?: number;
  looksLikeRetryOf?: string;
  userId?: string;
  adapter: ProtocolAdapter;
  writer?: SseSink;
  cancelReason?: CancelReason;
  heartbeat?: ReturnType<typeof setInterval>;
  attached: Promise<void>;
  resolveAttached: () => void;
  terminal: Promise<TerminalState>;
  resolveTerminal: (s: TerminalState) => void;
  terminalSettled: boolean;
};

const LIVE: JobStatus[] = ["pending", "claimed", "streaming"];
const ACTIVE: JobStatus[] = ["claimed", "streaming"];

export class JobEngine {
  private readonly jobs = new Map<string, Runtime>();
  private mutex: Promise<void> = Promise.resolve();
  private claimSweeper?: ReturnType<typeof setInterval>;
  private retentionTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly cfg: Config,
    private readonly db: CarbonDb,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.db.failInFlight(this.now());
    runRetention(this.db, this.cfg.jobs.retentionDays, this.now());
    this.claimSweeper = setInterval(() => {
      void this.sweepClaims();
    }, 2000);
    this.retentionTimer = setInterval(
      () => {
        runRetention(this.db, this.cfg.jobs.retentionDays, this.now());
      },
      60 * 60 * 1000,
    );
  }

  stop(): void {
    if (this.claimSweeper) clearInterval(this.claimSweeper);
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    for (const rt of this.jobs.values()) this.stopHeartbeat(rt);
  }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn);
    this.mutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async create(input: CreateJobInput): Promise<JobSummary> {
    return this.lock(async () => {
      const live = [...this.jobs.values()].filter((j) => LIVE.includes(j.status)).length;
      if (live >= this.cfg.jobs.maxPending) throw new JobQueueFullError();

      const id = ids.job();
      const createdAt = this.now();
      const normalized =
        input.normalized ??
        emptyNormalizedRequest({
          protocol: input.protocol,
          model: input.model ?? this.cfg.models.defaultId,
          displayModel: this.cfg.models.defaultDisplay,
          stream: input.stream,
        });
      const requestHash = await sha256Hex(input.rawBody);
      const prior = this.db.findByHash(requestHash);
      const vendorMessageId =
        input.protocol === "openai_chat"
          ? ids.chatcmpl()
          : input.protocol === "openai_responses"
            ? ids.resp()
            : ids.msg();

      let requestPath: string | null = null;
      let requestJson: string | null = null;
      if (input.rawBody.byteLength > RAW_INLINE_LIMIT) {
        const rawDir = join(this.db.dataDir, "raw");
        mkdirSync(rawDir, { recursive: true, mode: 0o700 });
        requestPath = join(rawDir, id);
        writeFileSync(requestPath, input.rawBody);
      } else {
        requestJson = new TextDecoder("utf-8", { fatal: false }).decode(input.rawBody);
      }

      let resolveAttached!: () => void;
      const attached = new Promise<void>((r) => {
        resolveAttached = r;
      });
      let resolveTerminal!: (s: TerminalState) => void;
      const terminal = new Promise<TerminalState>((r) => {
        resolveTerminal = r;
      });

      const rt: Runtime = {
        id,
        status: "pending",
        protocol: input.protocol,
        model: normalized.model,
        displayModel: normalized.displayModel,
        stream: input.stream,
        createdAt,
        request: normalized,
        vendorMessageId,
        events: [],
        requestHash,
        clientKeyId: input.clientKeyId ?? "debug",
        clientLabel: input.clientLabel ?? "debug",
        inputTokens: estimateRequestTokens(normalized),
        outputTokens: 0,
        looksLikeRetryOf: prior && prior.id !== id ? prior.id : undefined,
        userId: input.userId,
        adapter: input.adapter ?? new TestAdapter(),
        attached,
        resolveAttached,
        terminal,
        resolveTerminal,
        terminalSettled: false,
      };
      if (!input.stream) rt.resolveAttached();

      this.db.insertJob({
        id,
        status: rt.status,
        protocol: rt.protocol,
        vendor_id: vendorMessageId,
        model: rt.model,
        client_key_id: rt.clientKeyId,
        client_label: rt.clientLabel,
        stream: rt.stream ? 1 : 0,
        request_hash: requestHash,
        request_path: requestPath,
        request_json: requestJson,
        headers_json: JSON.stringify(input.headers),
        normalized_json: JSON.stringify(normalized),
        response_json: null,
        events_json: null,
        claimed_by: null,
        claimed_at: null,
        error_json: null,
        input_tokens: rt.inputTokens,
        output_tokens: null,
        created_at: createdAt,
        started_at: null,
        finished_at: null,
      });
      this.jobs.set(id, rt);
      return this.summary(rt);
    });
  }

  async attachSse(jobId: string, writer: SseSink, adapter?: ProtocolAdapter): Promise<void> {
    const rt = this.require(jobId);
    if (rt.writer) throw new JobConflictError(`job ${jobId} already has a stream`);
    if (adapter) rt.adapter = adapter;
    rt.writer = writer;
    const ctx = this.ctx(rt);
    await rt.adapter.openStream(ctx);
    this.startHeartbeat(rt);
    rt.resolveAttached();
  }

  waitUntilAttached(jobId: string): Promise<void> {
    return this.require(jobId).attached;
  }

  waitUntilTerminal(jobId: string): Promise<TerminalState> {
    return this.require(jobId).terminal;
  }

  async completeFromTest(
    jobId: string,
    blocks: AssistantBlock[],
    opts: { sessionId?: string; stopReason?: StopReason } = {},
  ): Promise<AssistantOutput> {
    const rt = this.require(jobId);
    if (!LIVE.includes(rt.status)) throw new JobConflictError(`job ${jobId} already ${rt.status}`);

    if (rt.stream) await rt.attached;

    return this.lock(async () => {
      const latest = this.require(jobId);
      if (!LIVE.includes(latest.status)) throw new JobConflictError(`job ${jobId} already ${latest.status}`);

      if (latest.status === "pending") {
        this.claimUnlocked(latest, opts.sessionId ?? "test");
      }
      latest.status = "streaming";
      latest.claimedAt = this.now();
      this.persistStatus(latest);

      const events = eventsFromBlocks({
        jobId: latest.id,
        vendorMessageId: latest.vendorMessageId,
        model: latest.model,
        createdAt: latest.createdAt,
        inputTokens: latest.inputTokens,
        blocks,
        stopReason: opts.stopReason,
      });
      latest.events = events;
      const output = fold(events);
      latest.outputTokens = output.outputTokens;

      if (latest.writer) {
        const ctx = this.ctx(latest);
        try {
          for (const ev of events) {
            await latest.adapter.apply(ctx, ev);
          }
          await latest.adapter.closeStream(ctx);
        } catch {
          this.finish(latest, { status: "cancelled", error: "write_fail" }, "write_fail");
          throw new JobConflictError("sse write failed");
        }
      }

      this.db.updateJob(latest.id, {
        response_json: JSON.stringify(latest.adapter.toJson(output, latest.request)),
        events_json: JSON.stringify(events),
        output_tokens: output.outputTokens,
      });
      this.finish(latest, { status: "completed" });
      return output;
    });
  }

  async cancel(jobId: string, reason: CancelReason): Promise<void> {
    return this.lock(async () => {
      const rt = this.jobs.get(jobId);
      if (!rt || !LIVE.includes(rt.status)) return;
      if (rt.writer) {
        try {
          await rt.adapter.closeStream(this.ctx(rt));
        } catch {
          try {
            await rt.writer.drain();
          } catch {
            // socket already dead
          }
        }
      }
      this.finish(rt, { status: "cancelled", error: reason }, reason);
    });
  }

  async claim(jobId: string, sessionId: string): Promise<JobSummary> {
    return this.lock(async () => {
      const rt = this.require(jobId);
      this.claimUnlocked(rt, sessionId);
      this.persistStatus(rt);
      return this.summary(rt);
    });
  }

  async release(jobId: string, sessionId: string): Promise<void> {
    return this.lock(async () => {
      const rt = this.require(jobId);
      if (rt.status !== "claimed" || rt.claimedBy !== sessionId) {
        throw new JobConflictError("cannot release job you do not hold");
      }
      rt.status = "pending";
      rt.claimedBy = undefined;
      rt.claimedAt = undefined;
      this.persistStatus(rt);
    });
  }

  get(jobId: string): JobSummary {
    return this.summary(this.require(jobId));
  }

  normalized(jobId: string): NormalizedRequest {
    return this.require(jobId).request;
  }

  output(jobId: string): AssistantOutput {
    const rt = this.require(jobId);
    return fold(rt.events);
  }

  json(jobId: string): unknown {
    const rt = this.require(jobId);
    return rt.adapter.toJson(fold(rt.events), rt.request);
  }

  list(): JobSummary[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((j) => this.summary(j));
  }

  private claimUnlocked(rt: Runtime, sessionId: string): void {
    if (rt.status === "claimed" && rt.claimedBy === sessionId) return;
    if (rt.status === "streaming" && rt.claimedBy === sessionId) return;
    if (rt.status !== "pending") throw new JobConflictError(`job ${rt.id} is ${rt.status}`);
    const active = [...this.jobs.values()].filter((j) => ACTIVE.includes(j.status)).length;
    if (active >= this.cfg.jobs.maxActive) {
      throw new JobConflictError(`max_active ${this.cfg.jobs.maxActive} reached`);
    }
    rt.status = "claimed";
    rt.claimedBy = sessionId;
    rt.claimedAt = this.now();
  }

  private startHeartbeat(rt: Runtime): void {
    this.stopHeartbeat(rt);
    const ms = this.cfg.jobs.heartbeatIntervalMs;
    rt.heartbeat = setInterval(() => {
      void this.beat(rt.id);
    }, ms);
  }

  private stopHeartbeat(rt: Runtime): void {
    if (rt.heartbeat) {
      clearInterval(rt.heartbeat);
      rt.heartbeat = undefined;
    }
  }

  private async beat(jobId: string): Promise<void> {
    const rt = this.jobs.get(jobId);
    if (!rt || !rt.writer || !LIVE.includes(rt.status)) return;
    try {
      await rt.adapter.heartbeat(this.ctx(rt));
    } catch {
      await this.cancel(jobId, "write_fail");
    }
  }

  private finish(rt: Runtime, state: TerminalState, reason?: CancelReason): void {
    if (rt.terminalSettled) return;
    rt.terminalSettled = true;
    rt.status = state.status;
    if (reason) rt.cancelReason = reason;
    this.stopHeartbeat(rt);
    this.db.updateJob(rt.id, {
      status: rt.status,
      claimed_by: rt.claimedBy ?? null,
      claimed_at: rt.claimedAt ?? null,
      error_json: state.error ? JSON.stringify({ code: state.error, message: state.error }) : null,
      finished_at: this.now(),
      output_tokens: rt.outputTokens,
      events_json: rt.events.length > 0 ? JSON.stringify(rt.events) : null,
    });
    rt.resolveAttached();
    rt.resolveTerminal(state);
  }

  private persistStatus(rt: Runtime): void {
    const patch: Parameters<CarbonDb["updateJob"]>[1] = {
      status: rt.status,
      claimed_by: rt.claimedBy ?? null,
      claimed_at: rt.claimedAt ?? null,
    };
    if (rt.status === "streaming") patch.started_at = this.now();
    this.db.updateJob(rt.id, patch);
  }

  private sweepClaims(): void {
    const ttl = this.cfg.jobs.claimTtlMs;
    const now = this.now();
    for (const rt of this.jobs.values()) {
      if (rt.status === "claimed" && rt.claimedAt && now - rt.claimedAt > ttl) {
        rt.status = "pending";
        rt.claimedBy = undefined;
        rt.claimedAt = undefined;
        this.persistStatus(rt);
      }
    }
  }

  private ctx(rt: Runtime): StreamCtx {
    if (!rt.writer) throw new Error("no sse writer");
    return {
      jobId: rt.id,
      writer: rt.writer,
      request: rt.request,
      vendorMessageId: rt.vendorMessageId,
    };
  }

  private require(jobId: string): Runtime {
    const rt = this.jobs.get(jobId);
    if (!rt) throw new JobNotFoundError(jobId);
    return rt;
  }

  private summary(rt: Runtime): JobSummary {
    return {
      id: rt.id,
      status: rt.status,
      protocol: rt.protocol,
      model: rt.model,
      displayModel: rt.displayModel,
      clientLabel: rt.clientLabel,
      stream: rt.stream,
      createdAt: rt.createdAt,
      waitMs: this.now() - rt.createdAt,
      inputTokensEst: rt.inputTokens,
      toolNames: toolNames(rt.request),
      lastUserPreview: lastUserPreview(rt.request),
      requestHash: rt.requestHash,
      claimedBy: rt.claimedBy,
      looksLikeRetryOf: rt.looksLikeRetryOf,
      userId: rt.userId,
    };
  }
}
