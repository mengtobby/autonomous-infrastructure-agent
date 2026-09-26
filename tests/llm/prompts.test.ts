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
    expect(content).toMatch(/did not match your expected output pattern/);
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

describe("the tagged reply format in prompts", () => {
  it("shows a worked example in tags, with the code unescaped, and no JSON schema", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("<file>");
    expect(prompt).toContain("class Greeter:\n    def greet");
    expect(prompt).not.toContain("full_file_content");
    expect(prompt).not.toMatch(/JSON object/);
  });

  it("asks for double-quoted shell programs, which the static checks require", () => {
    expect(buildSystemPrompt()).toMatch(/DOUBLE quotes/);
  });

  it("tells the model to keep the tests and fix the file when repairing", () => {
    expect(lastMessage(request)).toMatch(/Keep <test_command> and <expected_output_pattern> as they are/);
  });
});

describe("telling the model where its file lives in the sandbox", () => {
  const withPath = (target_file_path: string): RepairRequest => ({ ...request, incident: { ...request.incident, target_file_path } });

  it("states the working-directory-relative path, with the /app/ prefix stripped as the sandbox does", () => {
    const messages = buildRepairMessages(withPath("/app/src/utils/retry.js"));

    expect(messages[1]?.content).toContain("src/utils/retry.js");
    expect(messages[1]?.content).toMatch(/relative to the working directory/);
  });

  it("repeats it when asking for a repair, since wrong import paths are the common failure", () => {
    expect(lastMessage(withPath("/app/src/utils/retry.js"))).toContain("src/utils/retry.js");
  });
});

describe("feedback when the output did not match the pattern", () => {
  const mismatch: RepairRequest = {
    ...request,
    previousDraft: { ...request.previousDraft, test_commands: ['python -c "import x"'], expected_output_pattern: 'cpu{host="a"} 42' },
    failure: { lintIssues: [], sandboxResult: { exit_code: 0, stdout: 'cpu{host="a"}42', stderr: "", passed: false, timed_out: false, duration_ms: 1 } },
  };

  it("shows the pattern next to the actual output, so the difference is visible", () => {
    const content = lastMessage(mismatch);

    expect(content).toContain('Expected output pattern (a regular expression): cpu{host="a"} 42');
    expect(content).toContain('cpu{host="a"}42');
  });

  it("says the tests are frozen, so the fix has to be in the file", () => {
    expect(lastMessage(mismatch)).toMatch(/frozen.*change the <file>, not the tests/s);
  });

  it("does not claim the tests are frozen when the static checks rejected them", () => {
    const content = lastMessage({ ...request, failure: { lintIssues: ["pattern too broad"], sandboxResult: null } });

    expect(content).not.toMatch(/frozen/);
  });
});
