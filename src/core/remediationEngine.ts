import { checkPolicy } from "./policyChecker.js";
import { lintDraft } from "./draftLint.js";
import type { PipelineEvent, PipelineEventListener } from "./pipelineEvents.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmClient } from "../llm/llmClient.js";
import {
  remediationPlanSchema,
  type LlmRemediationDraft,
  type PolicyCheck,
  type RemediationPlan,
  type ResourceLimits,
  type SandboxRunResult,
  type Verdict,
  type VerificationAttempt,
} from "../schemas/remediation.schema.js";
import type { SandboxRunner } from "../sandbox/sandboxRunner.js";
import { unavailableResult } from "../sandbox/sandboxResult.js";
import { logger } from "../logging/logger.js";

export interface RemediationEngineOptions {
  llmClient: LlmClient;
  defaultResourceLimits: ResourceLimits;
  /** When set, every draft is executed in this sandbox before it is trusted. */
  verifier?: SandboxRunner | null;
  /** How many times a failed draft may be sent back to the model for repair. */
  maxRepairAttempts?: number;
}

export interface RemediateOptions {
  onEvent?: PipelineEventListener;
}

interface VerificationOutcome {
  draft: LlmRemediationDraft;
  attempts: VerificationAttempt[];
  verdict: Verdict;
  note: string | null;
}

type Emit = (event: PipelineEvent) => void;

/**
 * Orchestrates a single incident: deterministic policy gate -> LLM draft ->
 * static checks -> sandbox verification -> (on failure) feed the real error
 * back to the model and try again -> auditable RemediationPlan.
 *
 * The policy gate runs before the LLM is ever invoked, so a CRITICAL/HIGH
 * risk path never reaches the model and never gets file content generated.
 * A draft is only called VERIFIED if its own tests actually passed.
 */
export class RemediationEngine {
  private readonly llmClient: LlmClient;
  private readonly defaultResourceLimits: ResourceLimits;
  private readonly verifier: SandboxRunner | null;
  private readonly maxRepairAttempts: number;

  constructor(options: RemediationEngineOptions) {
    this.llmClient = options.llmClient;
    this.defaultResourceLimits = options.defaultResourceLimits;
    this.verifier = options.verifier ?? null;
    this.maxRepairAttempts = Math.max(0, options.maxRepairAttempts ?? 2);
  }

  async remediate(incident: IncidentAlert, options: RemediateOptions = {}): Promise<RemediationPlan> {
    const emit = safeEmitter(options.onEvent);

    const policyCheck = checkPolicy({
      targetFilePath: incident.target_file_path,
      errorLog: incident.error_log,
      serviceRequirementsContext: incident.service_requirements_context,
    });
    emit({ type: "policy_checked", policy: policyCheck });

    if (!policyCheck.is_safe_to_remediate) {
      logger.warn({ incidentId: incident.incident_id, policyCheck }, "Remediation blocked by policy check");
      const blockedPlan = remediationPlanSchema.parse(buildBlockedPlan(incident, policyCheck));
      emit({ type: "run_finished", plan: blockedPlan });
      return blockedPlan;
    }

    logger.info({ incidentId: incident.incident_id, targetFilePath: incident.target_file_path }, "Requesting remediation draft from LLM");
    emit({ type: "draft_started", attempt: 1, kind: "initial" });
    const initialDraft = await this.llmClient.generateRemediationDraft(incident, policyCheck);

    const outcome = await this.verifyAndRepair(incident, policyCheck, initialDraft, emit);
    const plan = remediationPlanSchema.parse(this.assemblePlan(incident, policyCheck, outcome));
    emit({ type: "run_finished", plan });
    return plan;
  }

  private async verifyAndRepair(
    incident: IncidentAlert,
    policyCheck: PolicyCheck,
    initialDraft: LlmRemediationDraft,
    emit: Emit
  ): Promise<VerificationOutcome> {
    let draft = initialDraft;
    let attempts: VerificationAttempt[] = [];

    for (let attemptNumber = 1; ; attemptNumber += 1) {
      const kind = attemptNumber === 1 ? "initial" : "repair";
      emit({
        type: "draft_ready",
        attempt: attemptNumber,
        kind,
        moduleSummary: draft.module_summary,
        fileContent: draft.full_file_content,
        containerImage: draft.container_image,
        testCommands: draft.test_commands,
      });

      const round = await this.verifyDraft(incident, draft, attemptNumber, kind, emit);
      attempts = [...attempts, round.attempt];

      if (round.attempt.passed) {
        return { draft, attempts, verdict: "VERIFIED", note: null };
      }

      const environmentError = round.attempt.sandbox_run_result?.error;
      if (environmentError) {
        return { draft, attempts, verdict: "UNVERIFIED", note: environmentError };
      }

      if (round.lintIssues.length === 0 && !this.verifier) {
        return { draft, attempts, verdict: "UNVERIFIED", note: "No sandbox is configured, so this draft was not executed." };
      }

      if (attemptNumber > this.maxRepairAttempts) {
        return {
          draft,
          attempts,
          verdict: "FAILED_VERIFICATION",
          note: `The draft still failed verification after ${attemptNumber} attempt(s).`,
        };
      }

      emit({ type: "draft_started", attempt: attemptNumber + 1, kind: "repair" });
      try {
        draft = await this.llmClient.repairRemediationDraft({
          incident,
          policyCheck,
          previousDraft: draft,
          failure: { lintIssues: round.lintIssues, sandboxResult: round.attempt.sandbox_run_result },
          repairAttempt: attemptNumber,
        });
      } catch (error) {
        logger.error({ err: error, attempt: attemptNumber }, "Repair attempt failed");
        return {
          draft,
          attempts,
          verdict: "FAILED_VERIFICATION",
          note: `The model could not produce a repair: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  private async verifyDraft(
    incident: IncidentAlert,
    draft: LlmRemediationDraft,
    attemptNumber: number,
    kind: "initial" | "repair",
    emit: Emit
  ): Promise<{ attempt: VerificationAttempt; lintIssues: string[] }> {
    const lintIssues = lintDraft(draft, incident.target_file_path);
    emit({ type: "lint_finished", attempt: attemptNumber, issues: lintIssues });

    const sandboxResult = lintIssues.length === 0 ? await this.runSandbox(incident, draft, attemptNumber, emit) : null;

    const attempt: VerificationAttempt = {
      attempt: attemptNumber,
      kind,
      module_summary: draft.module_summary,
      full_file_content: draft.full_file_content,
      container_image: draft.container_image,
      test_commands: draft.test_commands,
      expected_output_pattern: draft.expected_output_pattern,
      lint_issues: lintIssues,
      sandbox_run_result: sandboxResult,
      passed: lintIssues.length === 0 && sandboxResult?.passed === true,
    };
    return { attempt, lintIssues };
  }

  private async runSandbox(
    incident: IncidentAlert,
    draft: LlmRemediationDraft,
    attemptNumber: number,
    emit: Emit
  ): Promise<SandboxRunResult | null> {
    if (!this.verifier) {
      return null;
    }

    emit({ type: "sandbox_started", attempt: attemptNumber, mode: this.verifier.mode });
    const result = await this.verifier
      .run({
        targetFilePath: incident.target_file_path,
        fileContent: draft.full_file_content,
        containerImage: draft.container_image,
        testCommands: draft.test_commands,
        expectedOutputPattern: draft.expected_output_pattern,
        resourceLimits: this.defaultResourceLimits,
      })
      .catch((error: unknown) => unavailableResult(`Sandbox failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`));
    emit({ type: "sandbox_finished", attempt: attemptNumber, result });
    return result;
  }

  private assemblePlan(incident: IncidentAlert, policyCheck: PolicyCheck, outcome: VerificationOutcome): RemediationPlan {
    const { draft, attempts, verdict, note } = outcome;

    return {
      incident_id: incident.incident_id,
      service_name: incident.service_name,
      target_file_path: incident.target_file_path,
      root_cause_analysis: draft.root_cause_analysis,
      policy_check: policyCheck,
      remediation: {
        action: "CREATE_FILE",
        module_summary: draft.module_summary,
        full_file_content: draft.full_file_content,
      },
      sandbox_verification: {
        container_image: draft.container_image,
        resource_limits: this.defaultResourceLimits,
        test_commands: draft.test_commands,
        expected_output_pattern: draft.expected_output_pattern,
      },
      sandbox_run_result: attempts[attempts.length - 1]?.sandbox_run_result ?? null,
      verdict,
      attempts,
      sandbox_mode: this.verifier?.mode ?? null,
      verification_note: note,
    };
  }
}

/** A misbehaving listener (e.g. a closed SSE connection) must never be able
 * to break remediation, so listener errors are logged and swallowed. */
function safeEmitter(listener: PipelineEventListener | undefined): Emit {
  return (event) => {
    try {
      listener?.(event);
    } catch (error) {
      logger.warn({ err: error, eventType: event.type }, "Pipeline event listener threw; ignoring");
    }
  };
}

function buildBlockedPlan(incident: IncidentAlert, policyCheck: PolicyCheck): RemediationPlan {
  return {
    incident_id: incident.incident_id,
    service_name: incident.service_name,
    target_file_path: incident.target_file_path,
    root_cause_analysis: {
      error_type: "PolicyBlocked",
      failing_component: incident.target_file_path,
      detailed_explanation: `Automated remediation was not attempted. ${policyCheck.risk_reasoning}`,
    },
    policy_check: policyCheck,
    remediation: {
      action: "BLOCKED",
      module_summary: "Remediation blocked by policy check; requires human review before any file is created.",
      full_file_content: "",
    },
    sandbox_verification: {
      container_image: "n/a",
      resource_limits: { cpu_limit: "0", memory_limit: "0m" },
      test_commands: [],
      expected_output_pattern: "N/A",
    },
    sandbox_run_result: null,
    verdict: "BLOCKED",
    attempts: [],
    sandbox_mode: null,
    verification_note: null,
  };
}
