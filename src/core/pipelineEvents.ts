import type {
  PolicyCheck,
  RemediationPlan,
  SandboxRunResult,
} from "../schemas/remediation.schema.js";
import type { SandboxMode } from "../sandbox/sandboxRunner.js";

/** Progress notifications emitted while an incident moves through the
 * pipeline. They exist so a UI can show the agent working in real time; the
 * engine never depends on anyone listening. */
export type PipelineEvent =
  | { type: "policy_checked"; policy: PolicyCheck }
  | { type: "draft_started"; attempt: number; kind: "initial" | "repair" }
  | {
      type: "draft_ready";
      attempt: number;
      kind: "initial" | "repair";
      moduleSummary: string;
      fileContent: string;
      containerImage: string;
      testCommands: string[];
    }
  | { type: "lint_finished"; attempt: number; issues: string[] }
  | { type: "sandbox_started"; attempt: number; mode: SandboxMode }
  | { type: "sandbox_finished"; attempt: number; result: SandboxRunResult }
  | { type: "run_finished"; plan: RemediationPlan };

export type PipelineEventListener = (event: PipelineEvent) => void;
