import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmRemediationDraft, PolicyCheck, SandboxRunResult } from "../schemas/remediation.schema.js";

/** Why the previous draft was rejected — fed back to the model verbatim so
 * the repair is grounded in what actually happened, not a guess. */
export interface DraftFailure {
  /** Deterministic problems found before anything was executed. */
  lintIssues: string[];
  /** What running the draft's own tests produced, if it got that far. */
  sandboxResult: SandboxRunResult | null;
}

export interface RepairRequest {
  incident: IncidentAlert;
  policyCheck: PolicyCheck;
  previousDraft: LlmRemediationDraft;
  failure: DraftFailure;
  /** 1-based repair round, for logging and prompt context. */
  repairAttempt: number;
}

/**
 * Abstraction over the model backing root-cause analysis and remediation
 * drafting. Kept separate from the Ollama HTTP client so the remediation
 * engine can be unit tested with a fake implementation and swapped to
 * another local or hosted provider without touching orchestration logic.
 */
export interface LlmClient {
  generateRemediationDraft(incident: IncidentAlert, policyCheck: PolicyCheck): Promise<LlmRemediationDraft>;
  /** Produces a corrected draft after the previous one failed verification. */
  repairRemediationDraft(request: RepairRequest): Promise<LlmRemediationDraft>;
}
