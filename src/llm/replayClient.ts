import type { DemoScenario } from "../demo/types.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmRemediationDraft, PolicyCheck } from "../schemas/remediation.schema.js";
import type { LlmClient, RepairRequest } from "./llmClient.js";

export interface ReplayLlmClientOptions {
  scenarios: readonly DemoScenario[];
  /** Simulated model latency per call, so a live UI has time to show each stage. */
  delayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Serves recorded model output for the built-in demo scenarios, so the full
 * pipeline (policy gate, static checks, real sandbox execution, repair loop)
 * can be demonstrated without a GPU or a good local model. Only the drafting
 * is replayed — everything downstream really runs. It refuses, rather than
 * improvises, for any incident it has no recording for.
 */
export class ReplayLlmClient implements LlmClient {
  private readonly draftsByIncidentId: ReadonlyMap<string, readonly LlmRemediationDraft[]>;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ReplayLlmClientOptions) {
    this.draftsByIncidentId = new Map(options.scenarios.map((scenario) => [scenario.incident.incident_id, scenario.recordedDrafts]));
    this.delayMs = options.delayMs ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateRemediationDraft(incident: IncidentAlert, _policyCheck: PolicyCheck): Promise<LlmRemediationDraft> {
    return this.recordedDraft(incident.incident_id, 0);
  }

  async repairRemediationDraft(request: RepairRequest): Promise<LlmRemediationDraft> {
    return this.recordedDraft(request.incident.incident_id, request.repairAttempt);
  }

  private async recordedDraft(incidentId: string, index: number): Promise<LlmRemediationDraft> {
    const drafts = this.draftsByIncidentId.get(incidentId);
    if (!drafts || drafts.length === 0) {
      throw new Error(
        `Replay mode has no recording for incident '${incidentId}'. Pick a built-in scenario, or run with ` +
          "LLM_PROVIDER=ollama to draft with a live model."
      );
    }

    const draft = drafts[index];
    if (!draft) {
      throw new Error(`Replay mode has no recording for repair round ${index} of incident '${incidentId}'.`);
    }

    await this.sleep(this.delayMs);
    return draft;
  }
}
