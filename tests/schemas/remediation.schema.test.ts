import { describe, expect, it } from "vitest";
import { remediationPlanSchema, llmRemediationDraftSchema } from "../../src/schemas/remediation.schema.js";

describe("remediationPlanSchema", () => {
  it("accepts a fully-formed CREATE_FILE plan", () => {
    const plan = {
      incident_id: "INC-1",
      service_name: "svc",
      target_file_path: "/app/x.py",
      root_cause_analysis: {
        error_type: "ModuleNotFoundError",
        failing_component: "/app/x.py",
        detailed_explanation: "missing file",
      },
      policy_check: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary module" },
      remediation: { action: "CREATE_FILE", module_summary: "adds x", full_file_content: "print('hi')\n" },
      sandbox_verification: {
        container_image: "python:3.11-slim",
        resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
        test_commands: ["python -c \"print('ok')\""],
        expected_output_pattern: "ok",
      },
      sandbox_run_result: null,
    };
    expect(() => remediationPlanSchema.parse(plan)).not.toThrow();
  });

  it("rejects an invalid risk_level", () => {
    const plan = {
      incident_id: "INC-1",
      service_name: "svc",
      target_file_path: "/app/x.py",
      root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
      policy_check: { is_safe_to_remediate: true, risk_level: "SUPER_HIGH", risk_reasoning: "r" },
      remediation: { action: "CREATE_FILE", module_summary: "s", full_file_content: "c" },
      sandbox_verification: {
        container_image: "img",
        resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
        test_commands: [],
        expected_output_pattern: "ok",
      },
    };
    expect(() => remediationPlanSchema.parse(plan)).toThrow();
  });
});

describe("llmRemediationDraftSchema", () => {
  it("requires at least one test command", () => {
    const draft = {
      root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
      module_summary: "s",
      full_file_content: "content",
      container_image: "python:3.11-slim",
      test_commands: [],
      expected_output_pattern: "ok",
    };
    expect(() => llmRemediationDraftSchema.parse(draft)).toThrow();
  });
});
