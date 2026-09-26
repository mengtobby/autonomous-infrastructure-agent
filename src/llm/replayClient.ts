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
 * improvises, for any incident it has no recording for, including a recorded
 * incident id whose contents have been altered: a recording only answers the
 * exact incident it was made for.
 */
export class ReplayLlmClient implements LlmClient {
  private readonly scenariosByIncidentId: ReadonlyMap<string, DemoScenario>;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ReplayLlmClientOptions) {
    this.scenariosByIncidentId = new Map(options.scenarios.map((scenario) => [scenario.incident.incident_id, scenario]));
    this.delayMs = options.delayMs ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateRemediationDraft(incident: IncidentAlert, _policyCheck: PolicyCheck): Promise<LlmRemediationDraft> {
    return this.recordedDraft(incident, 0);
  }

  async repairRemediationDraft(request: RepairRequest): Promise<LlmRemediationDraft> {
    return this.recordedDraft(request.incident, request.repairAttempt);
  }

  private async recordedDraft(incident: IncidentAlert, index: number): Promise<LlmRemediationDraft> {
    const incidentId = incident.incident_id;
    const scenario = this.scenariosByIncidentId.get(incidentId);
    const drafts = scenario?.recordedDrafts;
    if (!scenario || !drafts || drafts.length === 0) {
      throw new Error(
        `Replay mode has no recording for incident '${incidentId}'. Pick a built-in scenario, or run with ` +
          "LLM_PROVIDER=ollama to draft with a live model."
      );
    }

    if (!sameIncident(incident, scenario.incident)) {
      throw new Error(
        `Replay mode only answers the built-in incident '${incidentId}' exactly as recorded; this one was modified. ` +
          "Run with LLM_PROVIDER=ollama to draft for your own incidents."
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

function sameIncident(a: IncidentAlert, b: IncidentAlert): boolean {
  return (
    a.incident_id === b.incident_id &&
    a.service_name === b.service_name &&
    a.timestamp === b.timestamp &&
    a.target_file_path === b.target_file_path &&
    a.error_log === b.error_log &&
    a.service_requirements_context === b.service_requirements_context
  );
}
