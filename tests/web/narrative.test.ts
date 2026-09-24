import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain browser ES module with no type declarations
import { applyEvent, initialModel, modelFromEvents } from "../../public/js/runModel.js";
// @ts-expect-error -- plain browser ES module with no type declarations
import { describeNow, explainRunError } from "../../public/js/narrative.js";

const policy = { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ok" };
const timed = (event: object) => ({ seq: 1, at: "", event });
const run = (events: object[]) => modelFromEvents(events.map(timed));

const failed = { exit_code: 1, stdout: "", stderr: "x", passed: false, timed_out: false, duration_ms: 5 };
const passed = { exit_code: 0, stdout: "OK", stderr: "", passed: true, timed_out: false, duration_ms: 5 };
const ready = (attempt: number, kind: string) => ({
  type: "draft_ready",
  attempt,
  kind,
  moduleSummary: "s",
  fileContent: "c",
  containerImage: "python:3.11-slim",
  testCommands: ["echo"],
});

describe("describeNow", () => {
  it("shows the scenario's own blurb before a run starts", () => {
    expect(describeNow(initialModel(), { blurb: "Watch the agent repair a bug." })).toEqual({
      tone: "idle",
      text: "Watch the agent repair a bug.",
    });
  });

  it("falls back to a prompt when there is no scenario", () => {
    expect(describeNow(initialModel(), null).text).toMatch(/Pick an incident/);
  });

  it("explains that the policy gate never reads the alert text", () => {
    const model = applyEvent(initialModel(), timed({ type: "draft_started", attempt: 1, kind: "initial" }));
    expect(describeNow(model, null).text).toMatch(/never the text of the alert/);
  });

  it("narrates each stage of a first attempt", () => {
    const base = [{ type: "policy_checked", policy }, { type: "draft_started", attempt: 1, kind: "initial" }];
    expect(describeNow(run(base), null).text).toMatch(/Asking the model/);
    expect(describeNow(run([...base, ready(1, "initial")]), null).text).toMatch(/static checks/);
    expect(describeNow(run([...base, ready(1, "initial"), { type: "lint_finished", attempt: 1, issues: [] }, { type: "sandbox_started", attempt: 1, mode: "local" }]), null).text).toMatch(/really being executed/);
  });

  it("names the moment the agent must catch its own mistake", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      ready(1, "initial"),
      { type: "lint_finished", attempt: 1, issues: [] },
      { type: "sandbox_finished", attempt: 1, result: failed },
    ]);
    expect(describeNow(model, null)).toMatchObject({ tone: "failure", text: expect.stringMatching(/catch its own mistake/) });
  });

  it("explains a repair is sending the real failure back", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      ready(1, "initial"),
      { type: "lint_finished", attempt: 1, issues: [] },
      { type: "sandbox_finished", attempt: 1, result: failed },
      { type: "draft_started", attempt: 2, kind: "repair" },
    ]);
    expect(describeNow(model, null).text).toMatch(/real failure output back/);
  });

  it("celebrates a repaired fix and says it was proven, not assumed", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      ready(1, "initial"),
      { type: "sandbox_finished", attempt: 1, result: failed },
      { type: "draft_started", attempt: 2, kind: "repair" },
      ready(2, "repair"),
      { type: "sandbox_finished", attempt: 2, result: passed },
      { type: "run_finished", plan: { verdict: "VERIFIED", attempts: [] } },
    ]);
    const now = describeNow(model, null);
    expect(now.tone).toBe("success");
    expect(now.text).toMatch(/one repair/);
    expect(now.text).toMatch(/proven by running it/);
  });

  it("describes a first-try success without mentioning repairs", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      ready(1, "initial"),
      { type: "run_finished", plan: { verdict: "VERIFIED", attempts: [] } },
    ]);
    expect(describeNow(model, null).text).toMatch(/first try/);
  });

  it("presents a blocked run as safe behaviour, not an error", () => {
    const model = run([
      { type: "policy_checked", policy: { ...policy, is_safe_to_remediate: false, risk_level: "HIGH" } },
      { type: "run_finished", plan: { verdict: "BLOCKED", attempts: [] } },
    ]);
    const now = describeNow(model, null);
    expect(now.tone).toBe("blocked");
    expect(now.text).toMatch(/high risk from the file path alone/);
    expect(now.text).toMatch(/no AI model was called/i);
  });

  it("says failing safe is correct when verification is exhausted", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "draft_started", attempt: 1, kind: "initial" },
      ready(1, "initial"),
      { type: "run_finished", plan: { verdict: "FAILED_VERIFICATION", attempts: [] } },
    ]);
    expect(describeNow(model, null).text).toMatch(/Failing safe/);
  });

  it("surfaces the verification note for an unverified draft", () => {
    const model = run([
      { type: "policy_checked", policy },
      { type: "run_finished", plan: { verdict: "UNVERIFIED", attempts: [], verification_note: "Docker is not available" } },
    ]);
    expect(describeNow(model, null)).toEqual({ tone: "warning", text: "Docker is not available" });
  });

  it("explains a run error with a recovery step", () => {
    const model = run([{ type: "run_failed", message: "Replay mode has no recording for incident 'X'." }]);
    expect(describeNow(model, null).text).toMatch(/LLM_PROVIDER=ollama/);
  });
});

describe("explainRunError", () => {
  it("guides the user when the local model is unreachable", () => {
    expect(explainRunError("Failed to generate a valid remediation draft ... Confirm Ollama is running")).toMatch(/Ollama is running/);
  });

  it("passes other errors through with context", () => {
    expect(explainRunError("kaboom")).toBe("The run failed: kaboom");
  });
});
