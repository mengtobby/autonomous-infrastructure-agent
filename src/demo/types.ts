import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmRemediationDraft, Verdict } from "../schemas/remediation.schema.js";

/** A ready-to-run incident for the dashboard and the replay provider. */
export interface DemoScenario {
  id: string;
  title: string;
  /** One sentence on what makes this scenario interesting to watch. */
  blurb: string;
  tags: string[];
  /** What a correct run should end in — asserted by the test suite. */
  expectedVerdict: Verdict;
  incident: IncidentAlert;
  /**
   * Recorded model output for the replay provider: index 0 is the first
   * draft, index N is the draft returned for repair round N. Empty for
   * scenarios the policy gate blocks before any drafting happens.
   */
  recordedDrafts: LlmRemediationDraft[];
}
