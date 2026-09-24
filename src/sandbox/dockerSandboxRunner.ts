import { randomUUID } from "node:crypto";
import type { SandboxRunResult } from "../schemas/remediation.schema.js";
import type { CommandRunner } from "./commandRunner.js";
import { validateContainerImage } from "./containerImage.js";
import type { SandboxJob, SandboxRunner } from "./sandboxRunner.js";
import { rejectedResult, skippedResult, toRunResult, unavailableResult } from "./sandboxResult.js";
import { buildSandboxWorkspace } from "./workspaceBuilder.js";
import { logger } from "../logging/logger.js";

export interface DockerSandboxRunnerOptions {
  commandRunner: CommandRunner;
  timeoutSeconds: number;
}

/** Runs a job's test commands inside a resource-bounded, network-isolated
 * Docker container and checks the combined output against the draft's
 * expected_output_pattern. Never mutates the host filesystem outside a
 * throwaway temp workspace, and never touches production infrastructure. */
export class DockerSandboxRunner implements SandboxRunner {
  readonly mode = "docker" as const;

  private readonly commandRunner: CommandRunner;
  private readonly timeoutSeconds: number;

  constructor(options: DockerSandboxRunnerOptions) {
    this.commandRunner = options.commandRunner;
    this.timeoutSeconds = options.timeoutSeconds;
  }

  async run(job: SandboxJob): Promise<SandboxRunResult> {
    if (job.testCommands.length === 0) {
      return skippedResult();
    }

    const image = validateContainerImage(job.containerImage);
    if (!image.valid) {
      return rejectedResult(`Sandbox refused the container image: ${image.reason}`);
    }

    const workspace = await buildSandboxWorkspace(job.targetFilePath, job.fileContent);
    const containerName = `infra-agent-sandbox-${randomUUID()}`;

    try {
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
        job.resourceLimits.cpu_limit,
        "--memory",
        job.resourceLimits.memory_limit,
        "-v",
        `${workspace.workspaceDir}:/workspace:ro`,
        "-w",
        "/workspace",
        "-e",
        "PYTHONPATH=/workspace",
        job.containerImage,
        "sh",
        "-c",
        job.testCommands.join(" && "),
      ];

      logger.info({ image: job.containerImage }, "Running sandbox verification in Docker");
      const result = await this.commandRunner.run("docker", dockerArgs, this.timeoutSeconds * 1000);

      // Killing the local `docker run` CLI process (what the timeout does)
      // does not stop the container in the daemon — it keeps running,
      // unbounded, orphaned from `--rm`'s normal-exit cleanup. Kill it by
      // name as a second step so a timed-out run never leaks a container.
      if (result.timedOut) {
        await this.commandRunner.run("docker", ["kill", containerName], 10_000).catch((error: unknown) => {
          logger.warn({ containerName, err: error }, "Failed to kill orphaned sandbox container after timeout");
        });
      }

      return toRunResult(result, job.expectedOutputPattern);
    } catch (error) {
      // A rejection here means `docker` itself couldn't be spawned.
      logger.error({ err: error }, "Docker sandbox could not be started");
      return unavailableResult(`Docker is not available: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await workspace.cleanup();
    }
  }
}
