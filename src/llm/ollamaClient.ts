import type { LlmRemediationDraft, PolicyCheck } from "../schemas/remediation.schema.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import { parseDraft } from "./draftFormat.js";
import { buildRepairMessages, buildSystemPrompt, buildUserPrompt, type ChatMessage } from "./prompts.js";
import { logger } from "../logging/logger.js";
import type { LlmClient, RepairRequest } from "./llmClient.js";

interface OllamaChatResponse {
  message?: { content?: string };
}

export interface OllamaLlmClientOptions {
  baseUrl: string;
  model: string;
  numCtx?: number;
  maxAttempts?: number;
  /** Hard cap per request, in ms. Ollama has no built-in request timeout —
   * a stuck/overloaded server would otherwise hang this call forever. */
  requestTimeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** LlmClient backed by a local Ollama server's /api/chat endpoint. Nothing
 * leaves the machine: no API key, no external network call. Replies use a
 * tagged plain-text format (see draftFormat.ts) rather than JSON, because
 * small local models cannot reliably escape source code inside a JSON string,
 * and rather than tool-calling, since not every local model supports tools. */
export class OllamaLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly numCtx: number;
  private readonly maxAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaLlmClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.numCtx = options.numCtx ?? 8192;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 180_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateRemediationDraft(incident: IncidentAlert, policyCheck: PolicyCheck): Promise<LlmRemediationDraft> {
    return this.requestDraft([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(incident, policyCheck) },
    ]);
  }

  async repairRemediationDraft(request: RepairRequest): Promise<LlmRemediationDraft> {
    return this.requestDraft(buildRepairMessages(request));
  }

  /** One chat round-trip, retried on transport errors, timeouts and replies
   * that do not parse into a valid draft. */
  private async requestDraft(messages: ChatMessage[]): Promise<LlmRemediationDraft> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,
            stream: false,
            messages,
            // num_predict defaults to a mere 128 tokens in Ollama if left
            // unset — nowhere near enough for a full source file plus the
            // surrounding tags. -1 means "generate until the model stops
            // or num_ctx is exhausted," which is what a complete draft needs.
            options: { num_ctx: this.numCtx, num_predict: -1 },
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed with status ${response.status}: ${await response.text()}`);
        }

        const body = (await response.json()) as OllamaChatResponse;
        const content = body.message?.content;
        if (!content) {
          throw new Error("Ollama response did not include message content.");
        }

        return parseDraft(content);
      } catch (error) {
        lastError = isAbortError(error)
          ? new Error(`Ollama request timed out after ${this.requestTimeoutMs / 1000}s`)
          : error;
        logger.warn({ attempt, maxAttempts: this.maxAttempts, err: lastError }, "Ollama remediation draft attempt failed");
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw new Error(
      `Failed to generate a valid remediation draft after ${this.maxAttempts} attempt(s) against ${this.baseUrl}: ${String(lastError)}. ` +
        `Confirm Ollama is running (\`ollama serve\`) and the model (\`${this.model}\`) is pulled (\`ollama pull ${this.model}\`).`
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
