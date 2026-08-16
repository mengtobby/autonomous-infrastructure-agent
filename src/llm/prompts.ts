import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { PolicyCheck } from "../schemas/remediation.schema.js";

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
    "4. Provide shell test_commands that can run inside a minimal container of container_image",
    "   to import/execute the new module and assert its behavior matches the requirements.",
    "   The final command's stdout must match expected_output_pattern on success.",
    "5. Respond with a single JSON object matching the required schema exactly. No markdown",
    "   fences, no commentary before or after it — the JSON object is your entire response.",
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
