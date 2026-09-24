import { describe, expect, it } from "vitest";
import { EXIT_CODES, exitCodeFor, mayWrite } from "../../src/cli/outcome.js";
import type { RemediationPlan, Verdict } from "../../src/schemas/remediation.schema.js";

function plan(verdict: Verdict | undefined, overrides: Partial<RemediationPlan> = {}): RemediationPlan {
  return {
    incident_id: "INC-1",
    service_name: "svc",
    target_file_path: "/app/x.py",
    root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
    policy_check: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ok" },
    remediation: { action: "CREATE_FILE", module_summary: "s", full_file_content: "x = 1\n" },
    sandbox_verification: {
      container_image: "python:3.11-slim",
      resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
      test_commands: ["echo ok"],
      expected_output_pattern: "ok",
    },
    verdict,
    ...overrides,
  };
}

describe("exitCodeFor", () => {
  it.each([
    ["VERIFIED", false, EXIT_CODES.OK],
    ["VERIFIED", true, EXIT_CODES.OK],
    ["BLOCKED", false, EXIT_CODES.BLOCKED],
    ["FAILED_VERIFICATION", true, EXIT_CODES.FAILED_VERIFICATION],
    ["UNVERIFIED", false, EXIT_CODES.OK],
    ["UNVERIFIED", true, EXIT_CODES.COULD_NOT_VERIFY],
  ] as const)("%s (verify requested: %s) exits %i", (verdict, verifyRequested, expected) => {
    expect(exitCodeFor(plan(verdict), verifyRequested)).toBe(expected);
  });

  it("falls back to the policy result for a plan with no verdict", () => {
    expect(exitCodeFor(plan(undefined), false)).toBe(EXIT_CODES.OK);
    expect(
      exitCodeFor(plan(undefined, { policy_check: { is_safe_to_remediate: false, risk_level: "CRITICAL", risk_reasoning: "no" } }), false)
    ).toBe(EXIT_CODES.BLOCKED);
  });
});

describe("mayWrite", () => {
  it("writes a verified draft", () => {
    expect(mayWrite(plan("VERIFIED"), true)).toBe(true);
  });

  it("never writes a draft that failed its own tests", () => {
    expect(mayWrite(plan("FAILED_VERIFICATION"), true)).toBe(false);
    expect(mayWrite(plan("FAILED_VERIFICATION"), false)).toBe(false);
  });

  it("writes an unverified draft only when the user chose not to verify", () => {
    expect(mayWrite(plan("UNVERIFIED"), false)).toBe(true);
    expect(mayWrite(plan("UNVERIFIED"), true)).toBe(false);
  });

  it("never writes a blocked plan, whatever else is true", () => {
    expect(mayWrite(plan("BLOCKED"), false)).toBe(false);
    expect(
      mayWrite(plan("VERIFIED", { remediation: { action: "BLOCKED", module_summary: "s", full_file_content: "" } }), true)
    ).toBe(false);
  });

  it("refuses a plan whose policy check says unsafe even if a verdict claims otherwise", () => {
    expect(
      mayWrite(plan("VERIFIED", { policy_check: { is_safe_to_remediate: false, risk_level: "HIGH", risk_reasoning: "no" } }), true)
    ).toBe(false);
  });
});
