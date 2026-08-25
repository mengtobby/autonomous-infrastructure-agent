import { describe, expect, it, vi } from "vitest";
import { DockerSandboxRunner } from "../../src/sandbox/dockerSandboxRunner.js";
import type { CommandRunner, CommandResult } from "../../src/sandbox/commandRunner.js";
import type { RemediationPlan } from "../../src/schemas/remediation.schema.js";

const basePlan: RemediationPlan = {
  incident_id: "INC-1",
  service_name: "svc",
  target_file_path: "/app/collectors/metrics_exporter.py",
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  policy_check: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary module" },
  remediation: { action: "CREATE_FILE", module_summary: "s", full_file_content: "print('hi')\n" },
  sandbox_verification: {
    container_image: "python:3.11-slim",
    resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
    test_commands: ["python -c \"print('hi')\"", "echo VERIFIED"],
    expected_output_pattern: "VERIFIED",
  },
  sandbox_run_result: null,
};

function fakeCommandRunner(result: CommandResult): CommandRunner {
  return { run: vi.fn().mockResolvedValue(result) };
}

describe("DockerSandboxRunner", () => {
  it("reports passed=true when exit code is 0 and stdout matches the pattern", async () => {
    const commandRunner = fakeCommandRunner({
      exitCode: 0,
      stdout: "hi\nVERIFIED\n",
      stderr: "",
      timedOut: false,
      durationMs: 42,
    });
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run(basePlan);

    expect(result.passed).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(commandRunner.run).toHaveBeenCalledTimes(1);
    const [command, args] = (commandRunner.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(command).toBe("docker");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain(basePlan.sandbox_verification.container_image);
  });

  it("reports passed=false when the expected pattern is absent even with exit code 0", async () => {
    const commandRunner = fakeCommandRunner({
      exitCode: 0,
      stdout: "hi\n",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run(basePlan);

    expect(result.passed).toBe(false);
  });

  it("reports passed=false and timed_out=true when the run times out", async () => {
    const commandRunner = fakeCommandRunner({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      durationMs: 30000,
    });
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run(basePlan);

    expect(result.passed).toBe(false);
    expect(result.timed_out).toBe(true);
  });

  it("kills the named container by name after a timeout, since SIGKILL-ing the CLI doesn't stop it", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs: 30000 });
    const commandRunner: CommandRunner = { run };
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    await runner.run(basePlan);

    expect(run).toHaveBeenCalledTimes(2);
    const [, firstArgs] = run.mock.calls[0] as [string, string[], number];
    const [secondCommand, secondArgs] = run.mock.calls[1] as [string, string[], number];
    const nameFlagIndex = firstArgs.indexOf("--name");
    expect(nameFlagIndex).toBeGreaterThanOrEqual(0);
    const containerName = firstArgs[nameFlagIndex + 1];

    expect(secondCommand).toBe("docker");
    expect(secondArgs).toEqual(["kill", containerName]);
  });

  it("does not attempt to kill a container when the run completes normally", async () => {
    const commandRunner = fakeCommandRunner({ exitCode: 0, stdout: "hi\nVERIFIED\n", stderr: "", timedOut: false, durationMs: 42 });
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    await runner.run(basePlan);

    expect(commandRunner.run).toHaveBeenCalledTimes(1);
  });

  it("never invokes the command runner for a BLOCKED remediation", async () => {
    const commandRunner = fakeCommandRunner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const blockedPlan: RemediationPlan = {
      ...basePlan,
      remediation: { action: "BLOCKED", module_summary: "blocked", full_file_content: "" },
      sandbox_verification: { ...basePlan.sandbox_verification, test_commands: [] },
    };

    const result = await runner.run(blockedPlan);

    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
  });
});
