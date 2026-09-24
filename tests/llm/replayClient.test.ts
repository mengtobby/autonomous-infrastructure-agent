import { describe, expect, it, vi } from "vitest";
import { ReplayLlmClient } from "../../src/llm/replayClient.js";
import type { DemoScenario } from "../../src/demo/types.js";
import type { LlmRemediationDraft } from "../../src/schemas/remediation.schema.js";

const draft = (summary: string): LlmRemediationDraft => ({
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  module_summary: summary,
  full_file_content: "x = 1\n",
  container_image: "python:3.11-slim",
  test_commands: ["echo VERIFIED"],
  expected_output_pattern: "VERIFIED",
});

const scenario: DemoScenario = {
  id: "s",
  title: "t",
  blurb: "b",
  tags: [],
  expectedVerdict: "VERIFIED",
  incident: {
    incident_id: "INC-REPLAY",
    service_name: "svc",
    timestamp: "2026-09-24T00:00:00Z",
    target_file_path: "/app/x.py",
    error_log: "boom",
    service_requirements_context: "needs x",
  },
  recordedDrafts: [draft("first"), draft("repaired")],
};

const policyCheck = { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ok" } as const;

describe("ReplayLlmClient", () => {
  it("returns the first recorded draft for the initial request", async () => {
    const client = new ReplayLlmClient({ scenarios: [scenario] });
    expect((await client.generateRemediationDraft(scenario.incident, policyCheck)).module_summary).toBe("first");
  });

  it("returns the recorded draft matching the repair round", async () => {
    const client = new ReplayLlmClient({ scenarios: [scenario] });
    const repaired = await client.repairRemediationDraft({
      incident: scenario.incident,
      policyCheck,
      previousDraft: draft("first"),
      failure: { lintIssues: [], sandboxResult: null },
      repairAttempt: 1,
    });
    expect(repaired.module_summary).toBe("repaired");
  });

  it("refuses, rather than improvises, for an incident with no recording", async () => {
    const client = new ReplayLlmClient({ scenarios: [scenario] });
    await expect(
      client.generateRemediationDraft({ ...scenario.incident, incident_id: "INC-UNKNOWN" }, policyCheck)
    ).rejects.toThrow(/no recording for incident 'INC-UNKNOWN'.*LLM_PROVIDER=ollama/);
  });

  it("says so when the recording has no further repair", async () => {
    const client = new ReplayLlmClient({ scenarios: [scenario] });
    await expect(
      client.repairRemediationDraft({
        incident: scenario.incident,
        policyCheck,
        previousDraft: draft("first"),
        failure: { lintIssues: [], sandboxResult: null },
        repairAttempt: 2,
      })
    ).rejects.toThrow(/repair round 2/);
  });

  it("waits the configured delay to simulate model latency", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ReplayLlmClient({ scenarios: [scenario], delayMs: 250, sleep });

    await client.generateRemediationDraft(scenario.incident, policyCheck);

    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not delay when it is about to refuse", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new ReplayLlmClient({ scenarios: [scenario], delayMs: 250, sleep });

    await client.generateRemediationDraft({ ...scenario.incident, incident_id: "nope" }, policyCheck).catch(() => undefined);

    expect(sleep).not.toHaveBeenCalled();
  });
});
