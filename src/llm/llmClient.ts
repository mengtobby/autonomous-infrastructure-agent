import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmRemediationDraft, PolicyCheck } from "../schemas/remediation.schema.js";

/**
 * Abstraction over the model backing root-cause analysis and remediation
 * drafting. Kept separate from the Ollama HTTP client so the remediation
 * engine can be unit tested with a fake implementation and swapped to
 * another local or hosted provider without touching orchestration logic.
 */
export interface LlmClient {
  generateRemediationDraft(incident: IncidentAlert, policyCheck: PolicyCheck): Promise<LlmRemediationDraft>;
}
