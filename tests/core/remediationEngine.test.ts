import { describe, expect, it, vi } from "vitest";
import { RemediationEngine } from "../../src/core/remediationEngine.js";
import type { PipelineEvent } from "../../src/core/pipelineEvents.js";
import type { LlmClient } from "../../src/llm/llmClient.js";
import type { IncidentAlert } from "../../src/schemas/incident.schema.js";
import type { LlmRemediationDraft, SandboxRunResult } from "../../src/schemas/remediation.schema.js";
import type { SandboxRunner } from "../../src/sandbox/sandboxRunner.js";

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
  full_file_content: "class PrometheusMetricsExporter:\n    def export_gauge(self):\n        return 1\n",
  container_image: "python:3.11-slim",
  test_commands: ["python -c \"import collectors.metrics_exporter; print('VERIFIED')\""],
  expected_output_pattern: "VERIFIED",
};

const repairedDraft: LlmRemediationDraft = {
  ...draft,
  module_summary: "Repaired: fixes the label formatting.",
  full_file_content: "class PrometheusMetricsExporter:\n    def export_gauge(self):\n        return 2\n",
};

const passingResult: SandboxRunResult = { exit_code: 0, stdout: "VERIFIED\n", stderr: "", passed: true, timed_out: false, duration_ms: 12 };
const failingResult: SandboxRunResult = {
  exit_code: 1,
  stdout: "",
  stderr: "AssertionError: label formatting",
  passed: false,
  timed_out: false,
  duration_ms: 12,
};

const defaultResourceLimits = { cpu_limit: "0.5", memory_limit: "256m" };

function fakeLlmClient(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateRemediationDraft: vi.fn().mockResolvedValue(draft),
    repairRemediationDraft: vi.fn().mockResolvedValue(repairedDraft),
    ...overrides,
  };
}

function fakeVerifier(...results: SandboxRunResult[]): SandboxRunner {
  const run = vi.fn();
  results.forEach((result) => run.mockResolvedValueOnce(result));
  run.mockResolvedValue(results[results.length - 1]);
  return { mode: "local", run };
}

describe("RemediationEngine — policy gate", () => {
  it("short-circuits without calling the LLM or sandbox when policy blocks the path", async () => {
    const llmClient = fakeLlmClient();
    const verifier = fakeVerifier(passingResult);
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier });

    const plan = await engine.remediate({ ...incident, target_file_path: "/etc/passwd" });

    expect(llmClient.generateRemediationDraft).not.toHaveBeenCalled();
    expect(verifier.run).not.toHaveBeenCalled();
    expect(plan.remediation.action).toBe("BLOCKED");
    expect(plan.remediation.full_file_content).toBe("");
    expect(plan.verdict).toBe("BLOCKED");
    expect(plan.attempts).toEqual([]);
    expect(plan.policy_check.risk_level).toBe("CRITICAL");
  });

  it("propagates an initial LLM failure instead of returning a partial plan", async () => {
    const llmClient = fakeLlmClient({ generateRemediationDraft: vi.fn().mockRejectedValue(new Error("model unavailable")) });
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    await expect(engine.remediate(incident)).rejects.toThrow("model unavailable");
  });
});

describe("RemediationEngine — verification", () => {
  it("marks a draft VERIFIED when it passes its sandbox tests first time", async () => {
    const llmClient = fakeLlmClient();
    const verifier = fakeVerifier(passingResult);
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("VERIFIED");
    expect(plan.attempts).toHaveLength(1);
    expect(plan.attempts?.[0]?.kind).toBe("initial");
    expect(plan.sandbox_mode).toBe("local");
    expect(plan.sandbox_run_result?.passed).toBe(true);
    expect(plan.remediation.full_file_content).toBe(draft.full_file_content);
    expect(llmClient.repairRemediationDraft).not.toHaveBeenCalled();
  });

  it("sends the real sandbox failure back to the model and verifies the repair", async () => {
    const llmClient = fakeLlmClient();
    const verifier = fakeVerifier(failingResult, passingResult);
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("VERIFIED");
    expect(plan.attempts?.map((attempt) => [attempt.kind, attempt.passed])).toEqual([
      ["initial", false],
      ["repair", true],
    ]);
    expect(plan.remediation.full_file_content).toBe(repairedDraft.full_file_content);

    const request = (llmClient.repairRemediationDraft as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(request.previousDraft).toEqual(draft);
    expect(request.failure.sandboxResult.stderr).toContain("AssertionError");
    expect(request.repairAttempt).toBe(1);
  });

  it("gives up with FAILED_VERIFICATION once the repair budget is spent", async () => {
    const llmClient = fakeLlmClient();
    const verifier = fakeVerifier(failingResult);
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier, maxRepairAttempts: 2 });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("FAILED_VERIFICATION");
    expect(plan.attempts).toHaveLength(3);
    expect(llmClient.repairRemediationDraft).toHaveBeenCalledTimes(2);
    expect(plan.verification_note).toMatch(/3 attempt/);
  });

  it("does not repair at all when maxRepairAttempts is 0", async () => {
    const llmClient = fakeLlmClient();
    const engine = new RemediationEngine({
      llmClient,
      defaultResourceLimits,
      verifier: fakeVerifier(failingResult),
      maxRepairAttempts: 0,
    });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("FAILED_VERIFICATION");
    expect(plan.attempts).toHaveLength(1);
    expect(llmClient.repairRemediationDraft).not.toHaveBeenCalled();
  });

  it("repairs a draft that fails static checks without ever running it", async () => {
    const badDraft: LlmRemediationDraft = { ...draft, full_file_content: '{"class": "PrometheusMetricsExporter"}' };
    const llmClient = fakeLlmClient({ generateRemediationDraft: vi.fn().mockResolvedValue(badDraft) });
    const verifier = fakeVerifier(passingResult);
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier });

    const plan = await engine.remediate(incident);

    expect(plan.attempts?.[0]?.lint_issues.length).toBeGreaterThan(0);
    expect(plan.attempts?.[0]?.sandbox_run_result).toBeNull();
    expect(verifier.run).toHaveBeenCalledTimes(1); // only the repaired draft was executed
    expect(plan.verdict).toBe("VERIFIED");
    const request = (llmClient.repairRemediationDraft as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(request.failure.lintIssues[0]).toMatch(/JSON object/);
  });

  it("returns UNVERIFIED without repairing when the sandbox itself is unavailable", async () => {
    const llmClient = fakeLlmClient();
    const unavailable: SandboxRunResult = { ...failingResult, stderr: "Docker is not available", error: "Docker is not available" };
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier: fakeVerifier(unavailable) });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("UNVERIFIED");
    expect(plan.verification_note).toBe("Docker is not available");
    expect(llmClient.repairRemediationDraft).not.toHaveBeenCalled();
  });

  it("returns UNVERIFIED, with a clear note, when no sandbox is configured", async () => {
    const llmClient = fakeLlmClient();
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("UNVERIFIED");
    expect(plan.sandbox_mode).toBeNull();
    expect(plan.verification_note).toMatch(/not executed/);
    expect(llmClient.generateRemediationDraft).toHaveBeenCalledTimes(1);
    expect(plan.remediation.action).toBe("CREATE_FILE");
  });

  it("still repairs lint failures when no sandbox is configured", async () => {
    const badDraft: LlmRemediationDraft = { ...draft, expected_output_pattern: ".*" };
    const llmClient = fakeLlmClient({ generateRemediationDraft: vi.fn().mockResolvedValue(badDraft) });
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits });

    const plan = await engine.remediate(incident);

    expect(llmClient.repairRemediationDraft).toHaveBeenCalledTimes(1);
    expect(plan.attempts).toHaveLength(2);
  });

  it("keeps the failed attempts and reports FAILED_VERIFICATION when the model cannot repair", async () => {
    const llmClient = fakeLlmClient({ repairRemediationDraft: vi.fn().mockRejectedValue(new Error("model crashed")) });
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier: fakeVerifier(failingResult) });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("FAILED_VERIFICATION");
    expect(plan.attempts).toHaveLength(1);
    expect(plan.verification_note).toMatch(/model crashed/);
  });

  it("treats a verifier that throws as an environment problem, not a failed draft", async () => {
    const verifier: SandboxRunner = { mode: "docker", run: vi.fn().mockRejectedValue(new Error("kaboom")) };
    const llmClient = fakeLlmClient();
    const engine = new RemediationEngine({ llmClient, defaultResourceLimits, verifier });

    const plan = await engine.remediate(incident);

    expect(plan.verdict).toBe("UNVERIFIED");
    expect(plan.verification_note).toMatch(/kaboom/);
    expect(llmClient.repairRemediationDraft).not.toHaveBeenCalled();
  });
});

describe("RemediationEngine — events", () => {
  it("emits the pipeline stages in order, including the repair loop", async () => {
    const events: PipelineEvent[] = [];
    const engine = new RemediationEngine({
      llmClient: fakeLlmClient(),
      defaultResourceLimits,
      verifier: fakeVerifier(failingResult, passingResult),
    });

    await engine.remediate(incident, { onEvent: (event) => events.push(event) });

    expect(events.map((event) => event.type)).toEqual([
      "policy_checked",
      "draft_started",
      "draft_ready",
      "lint_finished",
      "sandbox_started",
      "sandbox_finished",
      "draft_started",
      "draft_ready",
      "lint_finished",
      "sandbox_started",
      "sandbox_finished",
      "run_finished",
    ]);
    const finished = events[events.length - 1];
    expect(finished?.type === "run_finished" && finished.plan.verdict).toBe("VERIFIED");
  });

  it("emits policy_checked and run_finished for a blocked incident", async () => {
    const events: PipelineEvent[] = [];
    const engine = new RemediationEngine({ llmClient: fakeLlmClient(), defaultResourceLimits });

    await engine.remediate({ ...incident, target_file_path: "/etc/shadow" }, { onEvent: (event) => events.push(event) });

    expect(events.map((event) => event.type)).toEqual(["policy_checked", "run_finished"]);
  });

  it("is unaffected by an event listener that throws", async () => {
    const engine = new RemediationEngine({ llmClient: fakeLlmClient(), defaultResourceLimits, verifier: fakeVerifier(passingResult) });

    const plan = await engine.remediate(incident, {
      onEvent: () => {
        throw new Error("listener exploded");
      },
    });

    expect(plan.verdict).toBe("VERIFIED");
  });
});
