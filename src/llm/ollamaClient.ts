import { llmRemediationDraftSchema, type LlmRemediationDraft, type PolicyCheck } from "../schemas/remediation.schema.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { logger } from "../logging/logger.js";
import type { LlmClient } from "./llmClient.js";

/** JSON Schema mirroring llmRemediationDraftSchema, passed as Ollama's
 * `format` so the server constrains generation to valid, on-shape JSON
 * (supported by Ollama >= 0.5's structured outputs). */
const remediationDraftJsonSchema = {
  type: "object",
  properties: {
    root_cause_analysis: {
      type: "object",
      properties: {
        error_type: { type: "string" },
        failing_component: { type: "string" },
        detailed_explanation: { type: "string" },
      },
      required: ["error_type", "failing_component", "detailed_explanation"],
    },
    module_summary: { type: "string" },
    full_file_content: { type: "string" },
    container_image: { type: "string" },
    test_commands: { type: "array", items: { type: "string" } },
    expected_output_pattern: { type: "string" },
  },
  required: [
    "root_cause_analysis",
    "module_summary",
    "full_file_content",
    "container_image",
    "test_commands",
    "expected_output_pattern",
  ],
} as const;

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
 * leaves the machine: no API key, no external network call. Structured
 * output is enforced server-side via the `format` JSON schema rather than
 * tool-calling, since not every locally-hosted model supports tools. */
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
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: buildUserPrompt(incident, policyCheck) },
            ],
            format: remediationDraftJsonSchema,
            // num_predict defaults to a mere 128 tokens in Ollama if left
            // unset — nowhere near enough for a full source file plus the
            // surrounding JSON. -1 means "generate until the model stops
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

        const parsed = llmRemediationDraftSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          throw new Error(`Model output failed schema validation: ${parsed.error.message}`);
        }
        return parsed.data;
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
