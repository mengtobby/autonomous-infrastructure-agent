import { describe, expect, it } from "vitest";
import { formatProgress } from "../../src/cli/progress.js";
import type { RemediationPlan, SandboxRunResult } from "../../src/schemas/remediation.schema.js";

const result = (overrides: Partial<SandboxRunResult>): SandboxRunResult => ({
  exit_code: 0,
  stdout: "",
  stderr: "",
  passed: true,
  timed_out: false,
  duration_ms: 120,
  ...overrides,
});

describe("formatProgress", () => {
  it("reports an allowed policy decision", () => {
    const line = formatProgress({ type: "policy_checked", policy: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ok" } });
    expect(line).toMatch(/✔ policy gate.*LOW risk — remediation allowed/);
  });

  it("reports a blocked policy decision with the reasoning", () => {
    const line = formatProgress({
      type: "policy_checked",
      policy: { is_safe_to_remediate: false, risk_level: "CRITICAL", risk_reasoning: "system directory" },
    });
    expect(line).toMatch(/✖ policy gate.*CRITICAL.*BLOCKED.*system directory/);
  });

  it("distinguishes the first draft from a repair", () => {
    expect(formatProgress({ type: "draft_started", attempt: 1, kind: "initial" })).toMatch(/drafting/);
    expect(formatProgress({ type: "draft_started", attempt: 2, kind: "repair" })).toMatch(/repairing.*attempt 2/);
  });

  it("lists each static-check problem", () => {
    const line = formatProgress({ type: "lint_finished", attempt: 1, issues: ["a problem", "another"] });
    expect(line).toContain("2 problem(s)");
    expect(line).toContain("- a problem");
    expect(line).toContain("- another");
  });

  it("reports a clean static check", () => {
    expect(formatProgress({ type: "lint_finished", attempt: 1, issues: [] })).toMatch(/clean/);
  });

  it("reports a passing sandbox run with its duration", () => {
    expect(formatProgress({ type: "sandbox_finished", attempt: 2, result: result({}) })).toMatch(/attempt 2 passed in 120ms/);
  });

  it("reports the last stderr line of a failing sandbox run", () => {
    const line = formatProgress({
      type: "sandbox_finished",
      attempt: 1,
      result: result({ passed: false, exit_code: 1, stderr: "Traceback (most recent call last):\n  ...\nAssertionError: bad output" }),
    });
    expect(line).toMatch(/failed \(exit code 1\) — AssertionError: bad output/);
  });

  it("reports a timeout and an unavailable sandbox distinctly", () => {
    expect(formatProgress({ type: "sandbox_finished", attempt: 1, result: result({ passed: false, timed_out: true, exit_code: null }) })).toMatch(
      /timed out/
    );
    expect(formatProgress({ type: "sandbox_finished", attempt: 1, result: result({ passed: false, error: "Docker is not available" }) })).toMatch(
      /unavailable — Docker is not available/
    );
  });

  it("reports the final verdict, with the note when there is one", () => {
    const plan = { verdict: "FAILED_VERIFICATION", verification_note: "gave up" } as RemediationPlan;
    expect(formatProgress({ type: "run_finished", plan })).toBe("■ verdict         FAILED_VERIFICATION — gave up");
  });

  it("names the sandbox mode that is running the tests", () => {
    expect(formatProgress({ type: "sandbox_started", attempt: 1, mode: "local" })).toMatch(/running the draft's tests \(local\)/);
  });
});
