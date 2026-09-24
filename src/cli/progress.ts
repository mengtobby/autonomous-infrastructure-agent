import type { PipelineEvent } from "../core/pipelineEvents.js";
import type { SandboxRunResult } from "../schemas/remediation.schema.js";

const LABEL_WIDTH = 16;

const row = (icon: string, label: string, text: string): string => `${icon} ${label.padEnd(LABEL_WIDTH)}${text}`;

/** One human-readable line per pipeline event, for a live terminal view.
 * Each event yields a line, so the caller never has to special-case any. */
export function formatProgress(event: PipelineEvent): string {
  switch (event.type) {
    case "policy_checked":
      return event.policy.is_safe_to_remediate
        ? row("✔", "policy gate", `${event.policy.risk_level} risk — remediation allowed`)
        : row("✖", "policy gate", `${event.policy.risk_level} risk — BLOCKED. ${event.policy.risk_reasoning}`);
    case "draft_started":
      return event.kind === "initial"
        ? row("…", "drafting", "asking the model for a fix")
        : row("…", "repairing", `attempt ${event.attempt}: sending the failure back to the model`);
    case "draft_ready":
      return row("✔", `draft ${event.attempt}`, event.moduleSummary);
    case "lint_finished":
      return event.issues.length === 0
        ? row("✔", "static checks", `attempt ${event.attempt} clean`)
        : [
            row("✖", "static checks", `attempt ${event.attempt} found ${event.issues.length} problem(s)`),
            ...event.issues.map((issue) => `    - ${issue}`),
          ].join("\n");
    case "sandbox_started":
      return row("…", "sandbox", `running the draft's tests (${event.mode})`);
    case "sandbox_finished":
      return describeSandbox(event.attempt, event.result);
    case "run_finished":
      return row("■", "verdict", `${event.plan.verdict ?? "UNKNOWN"}${event.plan.verification_note ? ` — ${event.plan.verification_note}` : ""}`);
  }
}

function describeSandbox(attempt: number, result: SandboxRunResult): string {
  if (result.error) {
    return row("⚠", "sandbox", `unavailable — ${result.error}`);
  }
  if (result.passed) {
    return row("✔", "sandbox", `attempt ${attempt} passed in ${result.duration_ms}ms`);
  }

  const reason = result.timed_out ? "timed out" : `exit code ${String(result.exit_code)}`;
  const detail = mostInformativeLine(result.stderr) || mostInformativeLine(result.stdout);
  return row("✖", "sandbox", `attempt ${attempt} failed (${reason})${detail ? ` — ${detail}` : ""}`);
}

/** The last line that names an error (AssertionError, TypeError, …) — where a
 * traceback tells you what went wrong — falling back to the final line. */
function mostInformativeLine(text: string): string {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errorLine = [...lines].reverse().find((line) => /error|exception|assert|failed/i.test(line));
  return (errorLine ?? lines[lines.length - 1] ?? "").slice(0, 160);
}
