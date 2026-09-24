import type { SandboxRunResult } from "../schemas/remediation.schema.js";
import type { CommandRunner } from "./commandRunner.js";
import type { SandboxJob, SandboxRunner } from "./sandboxRunner.js";
import { skippedResult, toRunResult, unavailableResult } from "./sandboxResult.js";
import { buildSandboxWorkspace } from "./workspaceBuilder.js";
import { logger } from "../logging/logger.js";

/** Only these variables reach the drafted program — no API keys, tokens or
 * other secrets from the parent environment leak into generated code. */
const INHERITED_ENV_KEYS = ["PATH", "PATHEXT", "SystemRoot", "COMSPEC", "TEMP", "TMP", "HOME", "LANG"];

export interface LocalSandboxRunnerOptions {
  commandRunner: CommandRunner;
  timeoutSeconds: number;
}

/**
 * Verification without Docker: runs the drafted file's test commands as a
 * child process in a throwaway directory with a scrubbed environment, a hard
 * timeout that kills the whole process tree, and capped output.
 *
 * This is NOT equivalent to the Docker sandbox — there is no network or
 * filesystem isolation, so generated code runs with this user's privileges.
 * It exists for demos and development on machines without Docker, and the
 * factory in createSandbox.ts refuses to build it without explicit consent.
 */
export class LocalSandboxRunner implements SandboxRunner {
  readonly mode = "local" as const;

  private readonly commandRunner: CommandRunner;
  private readonly timeoutSeconds: number;

  constructor(options: LocalSandboxRunnerOptions) {
    this.commandRunner = options.commandRunner;
    this.timeoutSeconds = options.timeoutSeconds;
  }

  async run(job: SandboxJob): Promise<SandboxRunResult> {
    if (job.testCommands.length === 0) {
      return skippedResult();
    }

    const workspace = await buildSandboxWorkspace(job.targetFilePath, job.fileContent);

    try {
      logger.warn({ workspace: workspace.workspaceDir }, "Running sandbox verification locally (not isolated)");
      // With shell:true the whole command line is passed as `command`.
      const result = await this.commandRunner.run(job.testCommands.join(" && "), [], this.timeoutSeconds * 1000, {
        cwd: workspace.workspaceDir,
        env: buildEnvironment(workspace.workspaceDir),
        shell: true,
      });

      return toRunResult(result, job.expectedOutputPattern);
    } catch (error) {
      logger.error({ err: error }, "Local sandbox could not be started");
      return unavailableResult(`Local sandbox failed to start: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await workspace.cleanup();
    }
  }
}

function buildEnvironment(workspaceDir: string): Record<string, string> {
  const inherited = INHERITED_ENV_KEYS.flatMap((key) => {
    const value = process.env[key];
    return value === undefined ? [] : [[key, value] as const];
  });

  return {
    ...Object.fromEntries(inherited),
    PYTHONPATH: workspaceDir,
    PYTHONDONTWRITEBYTECODE: "1",
    NODE_PATH: workspaceDir,
  };
}
