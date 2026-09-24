import type { RemediationPlan, ResourceLimits, SandboxRunResult } from "../schemas/remediation.schema.js";

export type SandboxMode = "docker" | "local";

/** Everything a sandbox needs to verify one drafted file. Deliberately
 * narrower than RemediationPlan so the engine can verify each repair
 * attempt without assembling a full plan first. */
export interface SandboxJob {
  targetFilePath: string;
  fileContent: string;
  containerImage: string;
  testCommands: string[];
  expectedOutputPattern: string;
  resourceLimits: ResourceLimits;
}

export interface SandboxRunner {
  readonly mode: SandboxMode;
  run(job: SandboxJob): Promise<SandboxRunResult>;
}

export function toSandboxJob(plan: RemediationPlan): SandboxJob {
  return {
    targetFilePath: plan.target_file_path,
    fileContent: plan.remediation.full_file_content,
    containerImage: plan.sandbox_verification.container_image,
    testCommands: plan.sandbox_verification.test_commands,
    expectedOutputPattern: plan.sandbox_verification.expected_output_pattern,
    resourceLimits: plan.sandbox_verification.resource_limits,
  };
}
