import Anthropic from "@anthropic-ai/sdk";
import { llmRemediationDraftSchema, type LlmRemediationDraft, type PolicyCheck } from "../schemas/remediation.schema.js";
import type { IncidentAlert } from "../schemas/incident.schema.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";
import { logger } from "../logging/logger.js";
import type { LlmClient } from "./llmClient.js";

const REMEDIATION_TOOL_NAME = "emit_remediation_draft";

const remediationToolInputSchema = {
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
      additionalProperties: false,
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
  additionalProperties: false,
} as const;

type MessagesCreateFn = InstanceType<typeof Anthropic>["messages"]["create"];

export interface AnthropicLlmClientOptions {
  apiKey: string;
  model: string;
  maxAttempts?: number;
  /** Injectable for tests; defaults to a real Anthropic SDK client. */
  client?: { messages: { create: MessagesCreateFn } };
}

function isToolUseBlock(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

/** Anthropic-backed LlmClient. Forces structured output via tool_choice so
 * responses are parsed from typed tool input rather than free-text JSON,
 * eliminating markdown-fence stripping and prompt-injected formatting drift. */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: { messages: { create: MessagesCreateFn } };
  private readonly model: string;
  private readonly maxAttempts: number;

  constructor(options: AnthropicLlmClientOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  }

  async generateRemediationDraft(incident: IncidentAlert, policyCheck: PolicyCheck): Promise<LlmRemediationDraft> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: buildUserPrompt(incident, policyCheck) }],
          tools: [
            {
              name: REMEDIATION_TOOL_NAME,
              description: "Emit the root cause analysis and complete remediation file content for the incident.",
              input_schema: remediationToolInputSchema,
            },
          ],
          tool_choice: { type: "tool", name: REMEDIATION_TOOL_NAME },
        });

        const toolUse = response.content.find(isToolUseBlock);
        if (!toolUse) {
          throw new Error("Model response did not include the expected tool_use block.");
        }

        const parsed = llmRemediationDraftSchema.safeParse(toolUse.input);
        if (!parsed.success) {
          throw new Error(`Model output failed schema validation: ${parsed.error.message}`);
        }
        return parsed.data;
      } catch (error) {
        lastError = error;
        logger.warn({ attempt, maxAttempts: this.maxAttempts, err: error }, "LLM remediation draft attempt failed");
      }
    }

    throw new Error(
      `Failed to generate a valid remediation draft after ${this.maxAttempts} attempt(s): ${String(lastError)}`
    );
  }
}
