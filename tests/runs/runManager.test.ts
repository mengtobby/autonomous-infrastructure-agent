import { describe, expect, it, vi } from "vitest";
import type { RemediateOptions, RemediationEngine } from "../../src/core/remediationEngine.js";
import { RunManager, TooManyRunsError, type TimedRunEvent } from "../../src/runs/runManager.js";
import type { IncidentAlert } from "../../src/schemas/incident.schema.js";
import type { RemediationPlan, Verdict } from "../../src/schemas/remediation.schema.js";

const incident: IncidentAlert = {
  incident_id: "INC-1",
  service_name: "svc",
  timestamp: "2026-09-24T00:00:00Z",
  target_file_path: "/app/x.py",
  error_log: "boom",
  service_requirements_context: "needs x",
};

const planWith = (verdict: Verdict, attemptCount = 1): RemediationPlan => ({
  incident_id: "INC-1",
  service_name: "svc",
  target_file_path: "/app/x.py",
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  policy_check: { is_safe_to_remediate: verdict !== "BLOCKED", risk_level: "LOW", risk_reasoning: "r" },
  remediation: { action: "CREATE_FILE", module_summary: "s", full_file_content: "x" },
  sandbox_verification: {
    container_image: "python:3.11-slim",
    resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
    test_commands: ["echo ok"],
    expected_output_pattern: "ok",
  },
  verdict,
  attempts: Array.from({ length: attemptCount }, (_, index) => ({
    attempt: index + 1,
    kind: index === 0 ? ("initial" as const) : ("repair" as const),
    module_summary: "s",
    full_file_content: "x",
    container_image: "python:3.11-slim",
    test_commands: ["echo ok"],
    expected_output_pattern: "ok",
    lint_issues: [],
    sandbox_run_result: null,
    passed: index === attemptCount - 1,
  })),
});

/** An engine whose runs finish only when the test says so. */
function controllableEngine() {
  const pending: Array<{ resolve: (plan: RemediationPlan) => void; reject: (error: Error) => void; options: RemediateOptions }> = [];
  const engine = {
    remediate: vi.fn(
      (_incident: IncidentAlert, options: RemediateOptions = {}) =>
        new Promise<RemediationPlan>((resolve, reject) => {
          pending.push({ resolve, reject, options });
        })
    ),
  } as unknown as RemediationEngine;
  return { engine, pending };
}

const ids = (prefix = "run") => {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
};

describe("RunManager", () => {
  it("starts a run immediately in the running state", () => {
    const { engine } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });

    const record = manager.start(incident, "some-scenario");

    expect(record.status).toBe("running");
    expect(record.scenarioId).toBe("some-scenario");
    expect(manager.get(record.id)?.plan).toBeNull();
  });

  it("records pipeline events with increasing sequence numbers and stores the finished plan", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);

    pending[0]?.options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });
    pending[0]?.options.onEvent?.({ type: "lint_finished", attempt: 1, issues: [] });
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();

    const record = manager.get(id);
    expect(record?.status).toBe("finished");
    expect(record?.events.map((timed) => timed.seq)).toEqual([1, 2]);
    expect(record?.plan?.verdict).toBe("VERIFIED");
    expect(record?.finishedAt).not.toBeNull();
  });

  it("marks a run failed, keeps the message, and emits a terminal event when the engine throws", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);

    pending[0]?.reject(new Error("model unavailable"));
    await manager.whenIdle();

    const record = manager.get(id);
    expect(record?.status).toBe("failed");
    expect(record?.error).toBe("model unavailable");
    expect(record?.events.at(-1)?.event).toEqual({ type: "run_failed", message: "model unavailable" });
  });

  it("delivers recorded events first, then live ones, to a late subscriber", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);
    pending[0]?.options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });

    const received: TimedRunEvent[] = [];
    manager.subscribe(id, (timed) => received.push(timed));
    pending[0]?.options.onEvent?.({ type: "lint_finished", attempt: 1, issues: [] });

    expect(received.map((timed) => timed.event.type)).toEqual(["draft_started", "lint_finished"]);
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();
  });

  it("skips events the client already has when resuming after a sequence number", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);
    pending[0]?.options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });
    pending[0]?.options.onEvent?.({ type: "lint_finished", attempt: 1, issues: [] });

    const received: TimedRunEvent[] = [];
    manager.subscribe(id, (timed) => received.push(timed), 1);

    expect(received.map((timed) => timed.seq)).toEqual([2]);
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();
  });

  it("stops delivering events after unsubscribe", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);
    const received: TimedRunEvent[] = [];
    const unsubscribe = manager.subscribe(id, (timed) => received.push(timed));

    pending[0]?.options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });
    unsubscribe?.();
    pending[0]?.options.onEvent?.({ type: "lint_finished", attempt: 1, issues: [] });

    expect(received).toHaveLength(1);
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();
  });

  it("returns undefined when subscribing to an unknown run", () => {
    const { engine } = controllableEngine();
    expect(new RunManager({ engine }).subscribe("nope", () => undefined)).toBeUndefined();
  });

  it("keeps running when a subscriber throws", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    const { id } = manager.start(incident);
    manager.subscribe(id, () => {
      throw new Error("closed socket");
    });

    pending[0]?.options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();

    expect(manager.get(id)?.status).toBe("finished");
  });

  it("refuses to start more than maxConcurrent runs at once", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, maxConcurrent: 2, newId: ids() });

    manager.start(incident);
    manager.start(incident);

    expect(() => manager.start(incident)).toThrow(TooManyRunsError);
    pending[0]?.resolve(planWith("VERIFIED"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => manager.start(incident)).not.toThrow();

    pending.forEach((entry) => entry.resolve(planWith("VERIFIED")));
    await manager.whenIdle();
  });

  it("evicts the oldest finished runs beyond maxRuns but never a running one", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, maxRuns: 2, maxConcurrent: 10, newId: ids() });

    const first = manager.start(incident);
    pending[0]?.resolve(planWith("VERIFIED"));
    await manager.whenIdle();
    const second = manager.start(incident);
    const third = manager.start(incident);

    expect(manager.get(first.id)).toBeUndefined();
    expect(manager.get(second.id)?.status).toBe("running");
    expect(manager.get(third.id)?.status).toBe("running");

    pending.forEach((entry) => entry.resolve(planWith("VERIFIED")));
    await manager.whenIdle();
  });

  it("lists runs newest first with a summary", async () => {
    const { engine, pending } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    manager.start(incident);
    manager.start({ ...incident, service_name: "second" });
    pending[0]?.resolve(planWith("VERIFIED", 2));
    pending[1]?.resolve(planWith("BLOCKED", 0));
    await manager.whenIdle();

    const list = manager.list();

    expect(list.map((run) => run.serviceName)).toEqual(["second", "svc"]);
    expect(list[1]).toMatchObject({ verdict: "VERIFIED", attempts: 2, status: "finished" });
    expect(list[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("computes stats, counting a run as repaired only when it verified after more than one attempt", async () => {
    const { engine, pending } = controllableEngine();
    let clock = 0;
    const manager = new RunManager({ engine, maxConcurrent: 10, newId: ids(), now: () => new Date((clock += 1000)) });
    for (let i = 0; i < 4; i += 1) manager.start(incident);
    pending[0]?.resolve(planWith("VERIFIED", 1));
    pending[1]?.resolve(planWith("VERIFIED", 2));
    pending[2]?.resolve(planWith("BLOCKED", 0));
    pending[3]?.reject(new Error("boom"));
    await manager.whenIdle();

    const stats = manager.stats();

    expect(stats.total).toBe(4);
    expect(stats.byVerdict).toEqual({ VERIFIED: 2, BLOCKED: 1, FAILED_VERIFICATION: 0, UNVERIFIED: 0 });
    expect(stats.repaired).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.running).toBe(0);
    expect(stats.averageDurationMs).toBeGreaterThan(0);
  });

  it("reports null average duration when nothing has finished", () => {
    const { engine } = controllableEngine();
    const manager = new RunManager({ engine, newId: ids() });
    manager.start(incident);

    expect(manager.stats().averageDurationMs).toBeNull();
    expect(manager.stats().running).toBe(1);
  });
});
