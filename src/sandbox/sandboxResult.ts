import type { SandboxRunResult } from "../schemas/remediation.schema.js";
import type { CommandResult } from "./commandRunner.js";

/** Result for a job that was never executed (nothing to run). */
export function skippedResult(): SandboxRunResult {
  return { exit_code: null, stdout: "", stderr: "", passed: false, timed_out: false, duration_ms: 0 };
}

/** Result for a job that could not execute because the sandbox itself is
 * unavailable — distinct from the drafted code failing its tests. */
export function unavailableResult(message: string): SandboxRunResult {
  return { ...skippedResult(), stderr: message, error: message };
}

/** Result for a job rejected before execution because the draft asked for
 * something the sandbox refuses (e.g. a disallowed container image). This is
 * a draft problem the model can fix, so it is not marked as an environment error. */
export function rejectedResult(message: string): SandboxRunResult {
  return { ...skippedResult(), stderr: message };
}

/** A run passes only if it exited 0, didn't time out, and its combined
 * output matches the draft's own expected_output_pattern. */
export function toRunResult(command: CommandResult, expectedOutputPattern: string): SandboxRunResult {
  const passed =
    !command.timedOut && command.exitCode === 0 && matchesPattern(command.stdout + command.stderr, expectedOutputPattern);

  return {
    exit_code: command.exitCode,
    stdout: command.stdout,
    stderr: command.stderr,
    passed,
    timed_out: command.timedOut,
    duration_ms: command.durationMs,
  };
}

function matchesPattern(output: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(output);
  } catch {
    return output.includes(pattern);
  }
}
