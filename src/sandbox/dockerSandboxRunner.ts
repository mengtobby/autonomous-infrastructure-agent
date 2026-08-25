import { randomUUID } from "node:crypto";
import type { RemediationPlan, SandboxRunResult } from "../schemas/remediation.schema.js";
import type { CommandRunner } from "./commandRunner.js";
import { buildSandboxWorkspace } from "./workspaceBuilder.js";
import { logger } from "../logging/logger.js";

export interface DockerSandboxRunnerOptions {
  commandRunner: CommandRunner;
  timeoutSeconds: number;
}

/** Runs a RemediationPlan's sandbox_verification.test_commands inside a
 * resource-bounded, network-isolated Docker container and checks the
 * combined output against expected_output_pattern. Never mutates the host
 * filesystem outside a throwaway temp workspace, and never touches
 * production infrastructure. */
export class DockerSandboxRunner {
  private readonly commandRunner: CommandRunner;
  private readonly timeoutSeconds: number;

  constructor(options: DockerSandboxRunnerOptions) {
    this.commandRunner = options.commandRunner;
    this.timeoutSeconds = options.timeoutSeconds;
  }

  async run(plan: RemediationPlan): Promise<SandboxRunResult> {
    if (plan.remediation.action !== "CREATE_FILE" || plan.sandbox_verification.test_commands.length === 0) {
      return {
        exit_code: null,
        stdout: "",
        stderr: "",
        passed: false,
        timed_out: false,
        duration_ms: 0,
      };
    }

    const workspace = await buildSandboxWorkspace(plan.target_file_path, plan.remediation.full_file_content);
    const containerName = `infra-agent-sandbox-${randomUUID()}`;

    try {
      const script = plan.sandbox_verification.test_commands.join(" && ");
      const dockerArgs = [
        "run",
        "--rm",
        "--name",
        containerName,
        "--network",
        "none",
        "--pids-limit",
        "128",
        "--cpus",
        plan.sandbox_verification.resource_limits.cpu_limit,
        "--memory",
        plan.sandbox_verification.resource_limits.memory_limit,
        "-v",
        `${workspace.workspaceDir}:/workspace:ro`,
        "-w",
        "/workspace",
        "-e",
        "PYTHONPATH=/workspace",
        plan.sandbox_verification.container_image,
        "sh",
        "-c",
        script,
      ];

      logger.info({ image: plan.sandbox_verification.container_image }, "Running sandbox verification");
      const result = await this.commandRunner.run("docker", dockerArgs, this.timeoutSeconds * 1000);

      // Killing the local `docker run` CLI process (what the timeout above
      // does) does not stop the container in the daemon — it keeps running,
      // unbounded, orphaned from `--rm`'s normal-exit cleanup. Kill it by
      // name as a second step so a timed-out run never leaks a container.
      if (result.timedOut) {
        await this.commandRunner.run("docker", ["kill", containerName], 10_000).catch((error: unknown) => {
          logger.warn({ containerName, err: error }, "Failed to kill orphaned sandbox container after timeout");
        });
      }

      const passed = !result.timedOut && result.exitCode === 0 && matchesPattern(result.stdout + result.stderr, plan.sandbox_verification.expected_output_pattern);

      return {
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        passed,
        timed_out: result.timedOut,
        duration_ms: result.durationMs,
      };
    } finally {
      await workspace.cleanup();
    }
  }
}

function matchesPattern(output: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(output);
  } catch {
    return output.includes(pattern);
  }
}
