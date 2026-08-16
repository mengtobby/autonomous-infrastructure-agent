import { describe, expect, it, vi } from "vitest";
import { RemediationEngine } from "../../src/core/remediationEngine.js";
import type { LlmClient } from "../../src/llm/llmClient.js";
import type { IncidentAlert } from "../../src/schemas/incident.schema.js";
import type { LlmRemediationDraft } from "../../src/schemas/remediation.schema.js";

const incident: IncidentAlert = {
  incident_id: "INC-1",
  service_name: "telemetry-collector",
  timestamp: "2026-08-15T19:00:00Z",
  target_file_path: "/app/collectors/metrics_exporter.py",
  error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
  service_requirements_context: "Requires a PrometheusMetricsExporter class.",
};

const draft: LlmRemediationDraft = {
  root_cause_analysis: {
    error_type: "ModuleNotFoundError",
    failing_component: "/app/collectors/metrics_exporter.py",
    detailed_explanation: "The module is missing.",
  },
  module_summary: "Implements PrometheusMetricsExporter.",
  full_file_content: "class PrometheusMetricsExporter:\n    pass\n",
  container_image: "python:3.11-slim",
  test_commands: ["python -c \"import collectors.metrics_exporter\"", "echo VERIFIED"],
  expected_output_pattern: "VERIFIED",
};

function fakeLlmClient(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateRemediationDraft: vi.fn().mockResolvedValue(draft),
    ...overrides,
  };
}

const defaultResourceLimits = { cpu_limit: "0.5", memory_limit: "256m" };

describe("RemediationEngine", () => {
  it("calls the LLM and assembles a CREATE_FILE plan when the path is safe", async () => {
    const llmClient = fakeLlmClient();
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    const plan = await engine.remediate(incident);

    expect(llmClient.generateRemediationDraft).toHaveBeenCalledTimes(1);
    expect(plan.remediation.action).toBe("CREATE_FILE");
    expect(plan.remediation.full_file_content).toBe(draft.full_file_content);
    expect(plan.policy_check.is_safe_to_remediate).toBe(true);
    expect(plan.sandbox_verification.container_image).toBe("python:3.11-slim");
    expect(plan.sandbox_verification.resource_limits).toEqual(defaultResourceLimits);
  });

  it("short-circuits without calling the LLM when policy blocks the path", async () => {
    const llmClient = fakeLlmClient();
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    const blockedIncident: IncidentAlert = { ...incident, target_file_path: "/etc/passwd" };
    const plan = await engine.remediate(blockedIncident);

    expect(llmClient.generateRemediationDraft).not.toHaveBeenCalled();
    expect(plan.remediation.action).toBe("BLOCKED");
    expect(plan.remediation.full_file_content).toBe("");
    expect(plan.policy_check.is_safe_to_remediate).toBe(false);
    expect(plan.policy_check.risk_level).toBe("CRITICAL");
  });

  it("propagates LLM failures instead of returning a partial plan", async () => {
    const llmClient = fakeLlmClient({
      generateRemediationDraft: vi.fn().mockRejectedValue(new Error("model unavailable")),
    });
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    await expect(engine.remediate(incident)).rejects.toThrow("model unavailable");
  });
});
