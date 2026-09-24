import { randomUUID } from "node:crypto";
import type { PipelineEvent } from "../core/pipelineEvents.js";
import type { RemediationEngine } from "../core/remediationEngine.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { RemediationPlan, Verdict } from "../schemas/remediation.schema.js";
import { logger } from "../logging/logger.js";

export type RunEvent = PipelineEvent | { type: "run_failed"; message: string };

export interface TimedRunEvent {
  /** Monotonic per run, starting at 1 — doubles as the SSE event id. */
  seq: number;
  at: string;
  event: RunEvent;
}

export type RunStatus = "running" | "finished" | "failed";

export interface RunRecord {
  id: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Set when the run was started from a built-in scenario. */
  scenarioId: string | null;
  incident: IncidentAlert;
  events: readonly TimedRunEvent[];
  plan: RemediationPlan | null;
  error: string | null;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  createdAt: string;
  scenarioId: string | null;
  serviceName: string;
  targetFilePath: string;
  verdict: Verdict | null;
  attempts: number;
  durationMs: number | null;
}

export interface RunStats {
  total: number;
  running: number;
  failed: number;
  byVerdict: Record<Verdict, number>;
  /** Runs that only passed because a failed draft was repaired. */
  repaired: number;
  averageDurationMs: number | null;
}

export type RunListener = (event: TimedRunEvent) => void;

export class TooManyRunsError extends Error {
  constructor(limit: number) {
    super(`Too many runs in progress (limit ${limit}). Wait for one to finish.`);
    this.name = "TooManyRunsError";
  }
}

export interface RunManagerOptions {
  engine: RemediationEngine;
  /** Finished runs kept in memory; the oldest are evicted first. */
  maxRuns?: number;
  /** Runs allowed to execute at once, protecting the local model and sandbox. */
  maxConcurrent?: number;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Runs incidents in the background and records every pipeline event, so any
 * number of clients can watch a run live or replay a finished one. State is
 * held in memory: this is a demo/operator surface, not a system of record.
 */
export class RunManager {
  private readonly engine: RemediationEngine;
  private readonly maxRuns: number;
  private readonly maxConcurrent: number;
  private readonly now: () => Date;
  private readonly newId: () => string;

  private records = new Map<string, RunRecord>();
  private listeners = new Map<string, Set<RunListener>>();
  private inFlight = new Set<Promise<void>>();

  constructor(options: RunManagerOptions) {
    this.engine = options.engine;
    this.maxRuns = options.maxRuns ?? 100;
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  /** Starts a run and returns immediately; progress arrives via subscribe(). */
  start(incident: IncidentAlert, scenarioId: string | null = null): RunRecord {
    if (this.runningCount() >= this.maxConcurrent) {
      throw new TooManyRunsError(this.maxConcurrent);
    }

    const id = this.newId();
    const record: RunRecord = {
      id,
      status: "running",
      createdAt: this.now().toISOString(),
      finishedAt: null,
      scenarioId,
      incident,
      events: [],
      plan: null,
      error: null,
    };
    this.records.set(id, record);
    this.evictOldRuns();

    const execution = this.execute(id, incident).finally(() => this.inFlight.delete(execution));
    this.inFlight.add(execution);
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.records.get(id);
  }

  list(): RunSummary[] {
    return [...this.records.values()].reverse().map((record) => this.summarize(record));
  }

  /** Streams events for a run: everything recorded so far is delivered first,
   * then live events. Returns an unsubscribe function, or undefined for an
   * unknown run. Events with seq <= afterSeq are skipped (for reconnects). */
  subscribe(id: string, listener: RunListener, afterSeq = 0): (() => void) | undefined {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }

    record.events.filter((timed) => timed.seq > afterSeq).forEach(listener);

    const set = this.listeners.get(id) ?? new Set<RunListener>();
    set.add(listener);
    this.listeners.set(id, set);

    return () => {
      set.delete(listener);
    };
  }

  stats(): RunStats {
    const records = [...this.records.values()];
    const byVerdict: Record<Verdict, number> = { VERIFIED: 0, FAILED_VERIFICATION: 0, UNVERIFIED: 0, BLOCKED: 0 };
    let repaired = 0;

    for (const record of records) {
      const verdict = record.plan?.verdict;
      if (verdict) {
        byVerdict[verdict] += 1;
        if (verdict === "VERIFIED" && (record.plan?.attempts?.length ?? 0) > 1) {
          repaired += 1;
        }
      }
    }

    const durations = records.flatMap((record) => {
      const duration = this.durationMs(record);
      return duration === null ? [] : [duration];
    });

    return {
      total: records.length,
      running: this.runningCount(),
      failed: records.filter((record) => record.status === "failed").length,
      byVerdict,
      repaired,
      averageDurationMs: durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    };
  }

  /** Resolves once every run started so far has finished. For tests and shutdown. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  private async execute(id: string, incident: IncidentAlert): Promise<void> {
    try {
      const plan = await this.engine.remediate(incident, { onEvent: (event) => this.record(id, event) });
      this.update(id, { status: "finished", plan, finishedAt: this.now().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, runId: id }, "Run failed");
      this.record(id, { type: "run_failed", message });
      this.update(id, { status: "failed", error: message, finishedAt: this.now().toISOString() });
    }
  }

  private record(id: string, event: RunEvent): void {
    const current = this.records.get(id);
    if (!current) {
      return;
    }

    const timed: TimedRunEvent = { seq: current.events.length + 1, at: this.now().toISOString(), event };
    this.update(id, { events: [...current.events, timed] });

    this.listeners.get(id)?.forEach((listener) => {
      try {
        listener(timed);
      } catch (error) {
        logger.warn({ err: error, runId: id }, "Run listener threw; ignoring");
      }
    });
  }

  private update(id: string, changes: Partial<RunRecord>): void {
    const current = this.records.get(id);
    if (current) {
      this.records.set(id, { ...current, ...changes });
    }
  }

  private runningCount(): number {
    return [...this.records.values()].filter((record) => record.status === "running").length;
  }

  /** Drops the oldest finished runs once the cap is exceeded. */
  private evictOldRuns(): void {
    for (const [id, record] of this.records) {
      if (this.records.size <= this.maxRuns) {
        return;
      }
      if (record.status !== "running") {
        this.records.delete(id);
        this.listeners.delete(id);
      }
    }
  }

  private summarize(record: RunRecord): RunSummary {
    return {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt,
      scenarioId: record.scenarioId,
      serviceName: record.incident.service_name,
      targetFilePath: record.incident.target_file_path,
      verdict: record.plan?.verdict ?? null,
      attempts: record.plan?.attempts?.length ?? 0,
      durationMs: this.durationMs(record),
    };
  }

  private durationMs(record: RunRecord): number | null {
    return record.finishedAt ? new Date(record.finishedAt).getTime() - new Date(record.createdAt).getTime() : null;
  }
}
