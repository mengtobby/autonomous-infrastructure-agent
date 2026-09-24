import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain browser ES module with no type declarations
import { applyEvent, formatDuration, initialModel, latestAttempt, modelFromEvents, repairCount, stageStates } from "../../public/js/runModel.js";

const policy = { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary" };
const timed = (event: object, seq = 1) => ({ seq, at: "2026-09-24T00:00:00Z", event });

const failedResult = { exit_code: 1, stdout: "", stderr: "AssertionError: x", passed: false, timed_out: false, duration_ms: 400 };
const passedResult = { exit_code: 0, stdout: "VERIFIED\n", stderr: "", passed: true, timed_out: false, duration_ms: 1200 };

const draftReady = (attempt: number, kind: "initial" | "repair") => ({
  type: "draft_ready",
  attempt,
  kind,
  moduleSummary: `summary ${attempt}`,
  fileContent: `code ${attempt}`,
  containerImage: "python:3.11-slim",
  testCommands: ["echo ok"],
});

const repairedRun = [
  { type: "policy_checked", policy },
  { type: "draft_started", attempt: 1, kind: "initial" },
  draftReady(1, "initial"),
  { type: "lint_finished", attempt: 1, issues: [] },
  { type: "sandbox_started", attempt: 1, mode: "local" },
  { type: "sandbox_finished", attempt: 1, result: failedResult },
  { type: "draft_started", attempt: 2, kind: "repair" },
  draftReady(2, "repair"),
  { type: "lint_finished", attempt: 2, issues: [] },
  { type: "sandbox_started", attempt: 2, mode: "local" },
  { type: "sandbox_finished", attempt: 2, result: passedResult },
];

const finalPlan = (verdict: string, attempts: object[] = []) => ({ verdict, attempts, verification_note: null, policy_check: policy });

describe("applyEvent", () => {
  it("starts empty and not started", () => {
    const model = initialModel();
    expect(model.started).toBe(false);
    expect(model.attempts).toEqual([]);
  });

  it("does not mutate the previous model", () => {
    const before = initialModel();
    const after = applyEvent(before, timed({ type: "policy_checked", policy }));
    expect(before.policy).toBeNull();
    expect(after.policy).toEqual(policy);
  });

  it("tracks a draft from asking, to ready, to checked, to executed", () => {
    const model = modelFromEvents(repairedRun.slice(0, 6).map((event) => timed(event)));
    const attempt = latestAttempt(model);

    expect(attempt.drafting).toBe(false);
    expect(attempt.content).toBe("code 1");
    expect(attempt.lintIssues).toEqual([]);
    expect(attempt.sandboxState).toBe("done");
    expect(attempt.passed).toBe(false);
  });

  it("adds a repair attempt and counts repairs", () => {
    const model = modelFromEvents(repairedRun.map((event) => timed(event)));

    expect(model.attempts).toHaveLength(2);
    expect(model.attempts[1].kind).toBe("repair");
    expect(repairCount(model)).toBe(1);
  });

  it("tolerates draft_ready arriving without draft_started (a resumed stream)", () => {
    const model = applyEvent(initialModel(), timed(draftReady(2, "repair")));
    expect(model.attempts).toHaveLength(1);
    expect(model.attempts[0].n).toBe(2);
    expect(model.attempts[0].content).toBe("code 2");
  });

  it("ignores duplicate draft_started events", () => {
    const events = [
      { type: "draft_started", attempt: 1, kind: "initial" },
      { type: "draft_started", attempt: 1, kind: "initial" },
    ];
    expect(modelFromEvents(events.map((event) => timed(event))).attempts).toHaveLength(1);
  });

  it("lets the final plan settle pass/fail, including attempts that never reached the sandbox", () => {
    const plan = finalPlan("VERIFIED", [
      { attempt: 1, passed: false, lint_issues: ["fix this"] },
      { attempt: 2, passed: true, lint_issues: [] },
    ]);
    const events = [
      { type: "draft_started", attempt: 1, kind: "initial" },
      draftReady(1, "initial"),
      { type: "lint_finished", attempt: 1, issues: ["fix this"] },
      { type: "draft_started", attempt: 2, kind: "repair" },
      draftReady(2, "repair"),
      { type: "run_finished", plan },
    ];

    const model = modelFromEvents(events.map((event) => timed(event)));

    expect(model.done).toBe(true);
    expect(model.verdict).toBe("VERIFIED");
    expect(model.attempts.map((a: { passed: boolean }) => a.passed)).toEqual([false, true]);
  });

  it("records a failed run", () => {
    const model = applyEvent(initialModel(), timed({ type: "run_failed", message: "model unavailable" }));
    expect(model.done).toBe(true);
    expect(model.error).toBe("model unavailable");
  });

  it("ignores unknown event types", () => {
    const before = initialModel();
    expect(applyEvent(before, timed({ type: "something_new" }))).toBe(before);
  });
});

describe("stageStates", () => {
  const run = (events: object[]) => stageStates(modelFromEvents(events.map((event) => timed(event))));

  it("is all pending before a run starts", () => {
    const stages = stageStates(initialModel());
    expect(Object.values(stages).every((stage) => (stage as { state: string }).state === "pending")).toBe(true);
  });

  it("marks the policy gate as running until the decision arrives", () => {
    expect(run([{ type: "draft_started", attempt: 1, kind: "initial" }]).policy.state).toBe("active");
  });

  it("shows drafting as the active stage after the policy gate passes", () => {
    const stages = run([{ type: "policy_checked", policy }]);
    expect(stages.policy).toMatchObject({ state: "done", detail: "LOW risk" });
    expect(stages.draft.state).toBe("active");
  });

  it("shows the sandbox as failed after a failing run, with the exit code", () => {
    const stages = run(repairedRun.slice(0, 6));
    expect(stages.sandbox).toMatchObject({ state: "failed", detail: "failed · exit 1" });
    expect(stages.checks).toMatchObject({ state: "done", detail: "clean" });
  });

  it("returns to active work for the repair attempt", () => {
    const stages = run(repairedRun.slice(0, 7));
    expect(stages.draft).toMatchObject({ state: "active", detail: "repair 1" });
  });

  it("skips the sandbox when static checks fail", () => {
    const stages = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      draftReady(1, "initial"),
      { type: "lint_finished", attempt: 1, issues: ["a", "b"] },
    ]);
    expect(stages.checks).toMatchObject({ state: "failed", detail: "2 problems" });
    expect(stages.sandbox.state).toBe("skipped");
  });

  it("reports a repaired verdict with the repair count", () => {
    const stages = run([...repairedRun, { type: "run_finished", plan: finalPlan("VERIFIED", [{ attempt: 1, passed: false, lint_issues: [] }, { attempt: 2, passed: true, lint_issues: [] }]) }]);
    expect(stages.verdict).toMatchObject({ state: "done", detail: "repaired ×1" });
    expect(stages.sandbox).toMatchObject({ state: "done" });
  });

  it("shows a blocked run as skipped stages with a blocked verdict", () => {
    const stages = run([
      { type: "policy_checked", policy: { ...policy, is_safe_to_remediate: false, risk_level: "CRITICAL" } },
      { type: "run_finished", plan: finalPlan("BLOCKED") },
    ]);
    expect(stages.policy).toMatchObject({ state: "blocked", detail: "CRITICAL risk" });
    expect(stages.draft.state).toBe("skipped");
    expect(stages.sandbox.state).toBe("skipped");
    expect(stages.verdict.state).toBe("blocked");
  });

  it.each([
    ["FAILED_VERIFICATION", "failed"],
    ["UNVERIFIED", "skipped"],
  ])("maps the %s verdict to a %s stage", (verdict, state) => {
    const stages = run([{ type: "policy_checked", policy }, { type: "run_finished", plan: finalPlan(verdict) }]);
    expect(stages.verdict.state).toBe(state);
  });

  it("reports an unavailable sandbox distinctly from a failing draft", () => {
    const stages = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      draftReady(1, "initial"),
      { type: "lint_finished", attempt: 1, issues: [] },
      { type: "sandbox_finished", attempt: 1, result: { ...failedResult, error: "Docker is not available" } },
    ]);
    expect(stages.sandbox).toMatchObject({ state: "failed", detail: "unavailable" });
  });

  it("marks the verdict failed when the run itself errored", () => {
    const stages = run([{ type: "policy_checked", policy }, { type: "run_failed", message: "boom" }]);
    expect(stages.verdict.state).toBe("failed");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0ms"],
    [412, "412ms"],
    [1200, "1.2s"],
    [null, ""],
  ])("formats %s as %j", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
