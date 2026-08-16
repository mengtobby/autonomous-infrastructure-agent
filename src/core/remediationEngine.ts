import { checkPolicy } from "./policyChecker.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmClient } from "../llm/llmClient.js";
import { remediationPlanSchema, type PolicyCheck, type RemediationPlan, type ResourceLimits } from "../schemas/remediation.schema.js";
import { logger } from "../logging/logger.js";

export interface RemediationEngineOptions {
  llmClient: LlmClient;
  defaultResourceLimits: ResourceLimits;
}

/** Orchestrates a single incident through: deterministic policy gate -> (if
 * allowed) LLM-drafted root cause + remediation -> assembled RemediationPlan.
 * The policy gate runs before the LLM is ever invoked, so a CRITICAL/HIGH
 * risk path never reaches the model and never gets file content generated. */
export class RemediationEngine {
  private readonly llmClient: LlmClient;
  private readonly defaultResourceLimits: ResourceLimits;

  constructor(options: RemediationEngineOptions) {
    this.llmClient = options.llmClient;
    this.defaultResourceLimits = options.defaultResourceLimits;
  }

  async remediate(incident: IncidentAlert): Promise<RemediationPlan> {
    const policyCheck = checkPolicy({
      targetFilePath: incident.target_file_path,
      errorLog: incident.error_log,
      serviceRequirementsContext: incident.service_requirements_context,
    });

    if (!policyCheck.is_safe_to_remediate) {
      logger.warn({ incidentId: incident.incident_id, policyCheck }, "Remediation blocked by policy check");
      return remediationPlanSchema.parse(buildBlockedPlan(incident, policyCheck));
    }

    logger.info({ incidentId: incident.incident_id, targetFilePath: incident.target_file_path }, "Requesting remediation draft from LLM");
    const draft = await this.llmClient.generateRemediationDraft(incident, policyCheck);

    const plan: RemediationPlan = {
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
      sandbox_run_result: null,
    };

    return remediationPlanSchema.parse(plan);
  }
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
  };
}
