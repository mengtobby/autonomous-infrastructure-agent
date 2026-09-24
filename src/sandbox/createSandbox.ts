import type { AppConfig } from "../config/env.js";
import type { CommandRunner } from "./commandRunner.js";
import { DockerSandboxRunner } from "./dockerSandboxRunner.js";
import { LocalSandboxRunner } from "./localSandboxRunner.js";
import { ProcessCommandRunner } from "./processCommandRunner.js";
import type { SandboxMode, SandboxRunner } from "./sandboxRunner.js";

export interface SandboxSelection {
  /** Null when verification is switched off. */
  runner: SandboxRunner | null;
  mode: SandboxMode | "off";
  /** False when the configured sandbox can't currently run (e.g. no Docker). */
  available: boolean;
  /** Human-readable status, surfaced in the CLI and the dashboard. */
  note: string;
}

type SandboxConfig = Pick<AppConfig, "SANDBOX_MODE" | "SANDBOX_LOCAL_ACKNOWLEDGE" | "SANDBOX_TIMEOUT_SECONDS">;

export async function createSandbox(
  config: SandboxConfig,
  commandRunner: CommandRunner = new ProcessCommandRunner()
): Promise<SandboxSelection> {
  const timeoutSeconds = config.SANDBOX_TIMEOUT_SECONDS;

  if (config.SANDBOX_MODE === "off") {
    return { runner: null, mode: "off", available: false, note: "Verification is disabled (SANDBOX_MODE=off)." };
  }

  if (config.SANDBOX_MODE === "local") {
    if (!config.SANDBOX_LOCAL_ACKNOWLEDGE) {
      throw new Error(
        "SANDBOX_MODE=local runs generated commands directly on this machine with no isolation. " +
          "Set SANDBOX_LOCAL_ACKNOWLEDGE=true to confirm, or use SANDBOX_MODE=docker."
      );
    }
    return {
      runner: new LocalSandboxRunner({ commandRunner, timeoutSeconds }),
      mode: "local",
      available: true,
      note: "Local process sandbox — not isolated; generated code runs with this user's privileges.",
    };
  }

  const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds });
  const available = await isDockerAvailable(commandRunner);
  return {
    runner,
    mode: "docker",
    available,
    note: available
      ? "Docker sandbox — network disabled, CPU/memory/pid limits, read-only mount."
      : "Docker is not available; verification cannot run. Start Docker, or use SANDBOX_MODE=local for demos.",
  };
}

async function isDockerAvailable(commandRunner: CommandRunner): Promise<boolean> {
  try {
    const result = await commandRunner.run("docker", ["version", "--format", "{{.Server.Version}}"], 8_000);
    return result.exitCode === 0 && !result.timedOut;
  } catch {
    return false;
  }
}
