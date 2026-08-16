import { describe, expect, it, vi } from "vitest";
import { AnthropicLlmClient } from "../../src/llm/anthropicClient.js";
import type { IncidentAlert } from "../../src/schemas/incident.schema.js";
import type { PolicyCheck } from "../../src/schemas/remediation.schema.js";

const incident: IncidentAlert = {
  incident_id: "INC-1",
  service_name: "telemetry-collector",
  timestamp: "2026-08-15T19:00:00Z",
  target_file_path: "/app/collectors/metrics_exporter.py",
  error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
  service_requirements_context: "Requires a PrometheusMetricsExporter class.",
};

const policyCheck: PolicyCheck = { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary module" };

const validToolInput = {
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  module_summary: "s",
  full_file_content: "print('hi')\n",
  container_image: "python:3.11-slim",
  test_commands: ["echo ok"],
  expected_output_pattern: "ok",
};

function toolUseResponse(input: unknown) {
  return { content: [{ type: "tool_use", name: "emit_remediation_draft", input }] };
}

describe("AnthropicLlmClient", () => {
  it("parses a valid tool_use response into a validated draft", async () => {
    const create = vi.fn().mockResolvedValue(toolUseResponse(validToolInput));
    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-sonnet-5",
      client: { messages: { create } },
    });

    const draft = await client.generateRemediationDraft(incident, policyCheck);

    expect(draft.full_file_content).toBe("print('hi')\n");
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "emit_remediation_draft" });
  });

  it("retries once on schema-invalid tool input, then succeeds", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse({ ...validToolInput, test_commands: [] }))
      .mockResolvedValueOnce(toolUseResponse(validToolInput));

    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-sonnet-5",
      maxAttempts: 2,
      client: { messages: { create } },
    });

    const draft = await client.generateRemediationDraft(incident, policyCheck);

    expect(draft.full_file_content).toBe("print('hi')\n");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on repeated invalid output", async () => {
    const create = vi.fn().mockResolvedValue(toolUseResponse({ not: "valid" }));
    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-sonnet-5",
      maxAttempts: 2,
      client: { messages: { create } },
    });

    await expect(client.generateRemediationDraft(incident, policyCheck)).rejects.toThrow(
      /Failed to generate a valid remediation draft/
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws when the response has no tool_use block", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "oops" }] });
    const client = new AnthropicLlmClient({
      apiKey: "test-key",
      model: "claude-sonnet-5",
      maxAttempts: 1,
      client: { messages: { create } },
    });

    await expect(client.generateRemediationDraft(incident, policyCheck)).rejects.toThrow();
  });
});
