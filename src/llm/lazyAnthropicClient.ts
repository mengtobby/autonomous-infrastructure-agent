import type { IncidentAlert } from "../schemas/incident.schema.js";
import type { LlmRemediationDraft, PolicyCheck } from "../schemas/remediation.schema.js";
import type { AppConfig } from "../config/env.js";
import { requireAnthropicApiKey } from "../config/env.js";
import { AnthropicLlmClient } from "./anthropicClient.js";
import type { LlmClient } from "./llmClient.js";

/** Defers requiring ANTHROPIC_API_KEY (and constructing the real SDK client)
 * until a remediation draft is actually requested. This keeps policy-only
 * runs — e.g. an incident whose path gets blocked before the LLM is ever
 * consulted — working without an API key configured. */
export class LazyAnthropicLlmClient implements LlmClient {
  private readonly config: AppConfig;
  private delegate: AnthropicLlmClient | undefined;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async generateRemediationDraft(incident: IncidentAlert, policyCheck: PolicyCheck): Promise<LlmRemediationDraft> {
    if (!this.delegate) {
      this.delegate = new AnthropicLlmClient({
        apiKey: requireAnthropicApiKey(this.config),
        model: this.config.ANTHROPIC_MODEL,
      });
    }
    return this.delegate.generateRemediationDraft(incident, policyCheck);
  }
}
