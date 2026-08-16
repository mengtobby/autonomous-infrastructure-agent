import { z } from "zod";

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const remediationActionSchema = z.enum(["CREATE_FILE", "BLOCKED"]);
export type RemediationAction = z.infer<typeof remediationActionSchema>;

export const rootCauseAnalysisSchema = z.object({
  error_type: z.string().min(1),
  failing_component: z.string().min(1),
  detailed_explanation: z.string().min(1),
});
export type RootCauseAnalysis = z.infer<typeof rootCauseAnalysisSchema>;

export const policyCheckSchema = z.object({
  is_safe_to_remediate: z.boolean(),
  risk_level: riskLevelSchema,
  risk_reasoning: z.string().min(1),
});
export type PolicyCheck = z.infer<typeof policyCheckSchema>;

export const remediationSchema = z.object({
  action: remediationActionSchema,
  module_summary: z.string().min(1),
  full_file_content: z.string(),
});
export type Remediation = z.infer<typeof remediationSchema>;

export const resourceLimitsSchema = z.object({
  cpu_limit: z.string().min(1),
  memory_limit: z.string().min(1),
});
export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

export const sandboxVerificationSchema = z.object({
  container_image: z.string().min(1),
  resource_limits: resourceLimitsSchema,
  test_commands: z.array(z.string()),
  expected_output_pattern: z.string().min(1),
});
export type SandboxVerification = z.infer<typeof sandboxVerificationSchema>;

export const sandboxRunResultSchema = z.object({
  exit_code: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  passed: z.boolean(),
  timed_out: z.boolean(),
  duration_ms: z.number().nonnegative(),
});
export type SandboxRunResult = z.infer<typeof sandboxRunResultSchema>;

export const remediationPlanSchema = z.object({
  incident_id: z.string().min(1),
  service_name: z.string().min(1),
  target_file_path: z.string().min(1),
  root_cause_analysis: rootCauseAnalysisSchema,
  policy_check: policyCheckSchema,
  remediation: remediationSchema,
  sandbox_verification: sandboxVerificationSchema,
  sandbox_run_result: sandboxRunResultSchema.nullable().optional(),
});
export type RemediationPlan = z.infer<typeof remediationPlanSchema>;

/** Shape the LLM is prompted to return; narrower than RemediationPlan because
 * policy_check is decided deterministically, not by the model. */
export const llmRemediationDraftSchema = z.object({
  root_cause_analysis: rootCauseAnalysisSchema,
  module_summary: z.string().min(1),
  full_file_content: z.string().min(1),
  container_image: z.string().min(1),
  test_commands: z.array(z.string()).min(1),
  expected_output_pattern: z.string().min(1),
});
export type LlmRemediationDraft = z.infer<typeof llmRemediationDraftSchema>;
