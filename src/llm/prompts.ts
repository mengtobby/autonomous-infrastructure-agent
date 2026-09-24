import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { PolicyCheck, SandboxRunResult } from "../schemas/remediation.schema.js";
import type { RepairRequest } from "./llmClient.js";

/** Enough of a failing run's output to diagnose it, without flooding the
 * context window of a small local model. The tail is kept because that is
 * where tracebacks and assertion errors end up. */
const MAX_FEEDBACK_CHARS = 2_500;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const EXAMPLE_RESPONSE = JSON.stringify(
  {
    root_cause_analysis: {
      error_type: "ModuleNotFoundError",
      failing_component: "/app/greeting/greeter.py",
      detailed_explanation: "main.py imports greeting.greeter, but that file does not exist, so startup crashes.",
    },
    module_summary: "Adds a Greeter class with a greet(name) method.",
    full_file_content: 'class Greeter:\n    def greet(self, name: str) -> str:\n        return f"Hello, {name}!"\n',
    container_image: "python:3.11-slim",
    test_commands: [
      "python -c \"from greeting.greeter import Greeter; assert Greeter().greet('Ada') == 'Hello, Ada!'; print('VERIFIED')\"",
    ],
    expected_output_pattern: "VERIFIED",
  },
  null,
  2
);

export function buildSystemPrompt(): string {
  return [
    "You are an expert Site Reliability Engineer performing automated incident remediation.",
    "You will be given a microservice incident alert describing a missing or empty file that is",
    "crashing the service, plus the service's requirements for that file.",
    "",
    "Rules:",
    "1. Produce a COMPLETE, production-ready implementation. Never use placeholders such as",
    "   TODO, `pass`, or '# implement later'. Every function must be fully implemented.",
    "2. Respect standard infrastructure policy: safe defaults, structured error handling,",
    "   typed inputs where the language supports it, and no hardcoded secrets.",
    "3. Infer the target language/runtime from the file extension and the error log.",
    "4. full_file_content must be the RAW SOURCE TEXT of the file — not JSON describing the code,",
    "   not wrapped in markdown fences.",
    "5. test_commands run in a sandbox with NO network and NO package installs, with the file already",
    "   written at its path relative to the working directory. Use only the language runtime and its",
    "   standard library. Import or run the new module and ASSERT the behavior the requirements describe.",
    "6. Print a specific success marker (e.g. VERIFIED) only AFTER the assertions pass, and set",
    "   expected_output_pattern to that marker. Never use a pattern like .* that matches anything.",
    "7. container_image must be an official runtime image such as python:3.11-slim or node:20-slim.",
    "8. Respond with a single JSON object matching the required schema exactly. No commentary before",
    "   or after it — the JSON object is your entire response.",
    "",
    "Example of a correctly shaped response (for a different, unrelated incident):",
    EXAMPLE_RESPONSE,
  ].join("\n");
}

export function buildUserPrompt(incident: IncidentAlert, policyCheck: PolicyCheck): string {
  return [
    `Incident ID: ${incident.incident_id}`,
    `Service: ${incident.service_name}`,
    `Timestamp: ${incident.timestamp}`,
    `Target file (empty/missing): ${incident.target_file_path}`,
    "",
    "Error log:",
    incident.error_log,
    "",
    "Service requirements and architectural context:",
    incident.service_requirements_context,
    "",
    `Deterministic pre-check classified this remediation as risk level ${policyCheck.risk_level}`,
    `(${policyCheck.risk_reasoning}). This check already gates whether remediation proceeds at all —`,
    "you do not need to restate or re-justify it; focus on the root cause analysis and the file content.",
  ].join("\n");
}

/** Multi-turn: the incident, the model's own previous answer, then exactly
 * what went wrong with it. Grounds the fix in the real failure output. */
export function buildRepairMessages(request: RepairRequest): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(request.incident, request.policyCheck) },
    { role: "assistant", content: JSON.stringify(request.previousDraft) },
    { role: "user", content: buildFailureFeedback(request) },
  ];
}

function buildFailureFeedback(request: RepairRequest): string {
  const sections = [
    `Your draft failed verification (repair round ${request.repairAttempt}). Fix the specific problems below and return the`,
    "complete corrected JSON object again — the whole response, not a diff.",
  ];

  if (request.failure.lintIssues.length > 0) {
    sections.push("", "Problems found before running anything:", ...request.failure.lintIssues.map((issue) => `- ${issue}`));
  }

  if (request.failure.sandboxResult) {
    sections.push("", ...describeSandboxRun(request.failure.sandboxResult));
  }

  return sections.join("\n");
}

function describeSandboxRun(result: SandboxRunResult): string[] {
  const lines = ["Your test_commands were executed in the sandbox:"];

  if (result.timed_out) {
    lines.push("- The run TIMED OUT and was killed. Something loops forever or blocks.");
  } else if (result.exit_code !== 0) {
    lines.push(`- Exit code: ${String(result.exit_code)} (must be 0)`);
  } else {
    lines.push("- Exit code was 0, but the output did not match your expected_output_pattern.");
  }

  if (result.stdout.trim()) {
    lines.push("- stdout (tail):", tail(result.stdout));
  }
  if (result.stderr.trim()) {
    lines.push("- stderr (tail):", tail(result.stderr));
  }

  return lines;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_FEEDBACK_CHARS ? `…${trimmed.slice(trimmed.length - MAX_FEEDBACK_CHARS)}` : trimmed;
}
