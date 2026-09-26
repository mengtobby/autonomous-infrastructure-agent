import type { SandboxRunResult } from "../schemas/remediation.schema.js";
import type { CommandResult } from "./commandRunner.js";
import { safeRegexTest } from "./safeRegex.js";

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
 * output matches the draft's own expected_output_pattern. The pattern comes
 * from the model, so it is evaluated with a hard time limit. */
export async function toRunResult(command: CommandResult, expectedOutputPattern: string): Promise<SandboxRunResult> {
  let passed = false;
  let stderr = command.stderr;

  if (!command.timedOut && command.exitCode === 0) {
    const output = command.stdout + command.stderr;
    const outcome = await safeRegexTest(expectedOutputPattern, output);

    if (outcome === "timeout") {
      stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}expected_output_pattern took too long to evaluate and was abandoned. Use a simple, specific success marker such as VERIFIED.\n`;
    }
    // A pattern that is not a valid regex is treated as a literal marker.
    passed = outcome === "match" || (outcome === "invalid" && output.includes(expectedOutputPattern));
  }

  return {
    exit_code: command.exitCode,
    stdout: command.stdout,
    stderr,
    passed,
    timed_out: command.timedOut,
    duration_ms: command.durationMs,
  };
}

/** Replaces host-specific strings (the temp workspace path, and with it the
 * operator's username) in captured output before it leaves the sandbox layer. */
export function redactOutput(result: SandboxRunResult, hostStrings: string[]): SandboxRunResult {
  const scrub = (text: string): string =>
    hostStrings
      .filter((value) => value.length > 0)
      .reduce((current, value) => current.split(value).join("<sandbox>").split(value.replace(/\\/g, "/")).join("<sandbox>"), text);

  return { ...result, stdout: scrub(result.stdout), stderr: scrub(result.stderr) };
}
