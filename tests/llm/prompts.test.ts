import { describe, expect, it } from "vitest";
import { buildRepairMessages, buildSystemPrompt } from "../../src/llm/prompts.js";
import type { RepairRequest } from "../../src/llm/llmClient.js";

const request: RepairRequest = {
  incident: {
    incident_id: "INC-1",
    service_name: "svc",
    timestamp: "2026-08-15T19:00:00Z",
    target_file_path: "/app/x.py",
    error_log: "ModuleNotFoundError",
    service_requirements_context: "needs x",
  },
  policyCheck: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary" },
  previousDraft: {
    root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
    module_summary: "s",
    full_file_content: "old code",
    container_image: "python:3.11-slim",
    test_commands: ["python -c 'x'"],
    expected_output_pattern: "OK",
  },
  failure: { lintIssues: [], sandboxResult: null },
  repairAttempt: 2,
};

const lastMessage = (r: RepairRequest) => buildRepairMessages(r).at(-1)?.content ?? "";

describe("buildSystemPrompt", () => {
  it("steers the model away from the failure modes seen in practice", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/RAW SOURCE TEXT/);
    expect(prompt).toMatch(/NO network/);
    expect(prompt).toMatch(/matches anything/);
  });
});

describe("buildRepairMessages", () => {
  it("builds system, incident, previous answer, then feedback", () => {
    const messages = buildRepairMessages(request);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[2]?.content).toContain("old code");
    expect(messages[3]?.content).toContain("repair round 2");
  });

  it("includes lint problems as a list", () => {
    const content = lastMessage({ ...request, failure: { lintIssues: ["content is JSON", "pattern too broad"], sandboxResult: null } });
    expect(content).toContain("- content is JSON");
    expect(content).toContain("- pattern too broad");
  });

  it("reports a non-zero exit code with stdout and stderr", () => {
    const content = lastMessage({
      ...request,
      failure: {
        lintIssues: [],
        sandboxResult: { exit_code: 2, stdout: "some out", stderr: "Traceback: boom", passed: false, timed_out: false, duration_ms: 1 },
      },
    });
    expect(content).toContain("Exit code: 2");
    expect(content).toContain("some out");
    expect(content).toContain("Traceback: boom");
  });

  it("explains a timeout", () => {
    const content = lastMessage({
      ...request,
      failure: { lintIssues: [], sandboxResult: { exit_code: null, stdout: "", stderr: "", passed: false, timed_out: true, duration_ms: 9 } },
    });
    expect(content).toMatch(/TIMED OUT/);
  });

  it("explains a clean exit whose output did not match the expected pattern", () => {
    const content = lastMessage({
      ...request,
      failure: { lintIssues: [], sandboxResult: { exit_code: 0, stdout: "hello", stderr: "", passed: false, timed_out: false, duration_ms: 1 } },
    });
    expect(content).toMatch(/did not match your expected_output_pattern/);
  });

  it("keeps only the tail of very long output, where the error is", () => {
    const stderr = `${"noise\n".repeat(2000)}FINAL-ERROR-LINE`;
    const content = lastMessage({
      ...request,
      failure: { lintIssues: [], sandboxResult: { exit_code: 1, stdout: "", stderr, passed: false, timed_out: false, duration_ms: 1 } },
    });
    expect(content).toContain("FINAL-ERROR-LINE");
    expect(content.length).toBeLessThan(4_000);
  });
});
