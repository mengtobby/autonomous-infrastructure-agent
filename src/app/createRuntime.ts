import type { AppConfig } from "../config/env.js";
import { RemediationEngine } from "../core/remediationEngine.js";
import { demoScenarios } from "../demo/scenarios/index.js";
import type { LlmClient } from "../llm/llmClient.js";
import { OllamaLlmClient } from "../llm/ollamaClient.js";
import { ReplayLlmClient } from "../llm/replayClient.js";
import { createSandbox, type SandboxSelection } from "../sandbox/createSandbox.js";

export interface RuntimeInfo {
  provider: AppConfig["LLM_PROVIDER"];
  /** Model name for a live provider; null for replay. */
  model: string | null;
  sandbox: Pick<SandboxSelection, "mode" | "available" | "note">;
}

export interface Runtime {
  engine: RemediationEngine;
  info: RuntimeInfo;
}

export interface RuntimeOptions {
  /** Attach the sandbox so drafts are executed and repaired. */
  verify: boolean;
  /** Overrides MAX_REPAIR_ATTEMPTS for this runtime. */
  maxRepairAttempts?: number;
}

export function createLlmClient(config: AppConfig): LlmClient {
  if (config.LLM_PROVIDER === "replay") {
    return new ReplayLlmClient({ scenarios: demoScenarios, delayMs: config.REPLAY_DELAY_MS });
  }

  return new OllamaLlmClient({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
    numCtx: config.OLLAMA_NUM_CTX,
    requestTimeoutMs: config.OLLAMA_REQUEST_TIMEOUT_SECONDS * 1000,
  });
}

/** The single place the engine is assembled from configuration, so the CLI,
 * the server and the demo can never drift apart. */
export async function createRuntime(config: AppConfig, options: RuntimeOptions): Promise<Runtime> {
  const sandbox = options.verify
    ? await createSandbox(config)
    : ({ runner: null, mode: "off", available: false, note: "Verification not requested." } as const);

  const engine = new RemediationEngine({
    llmClient: createLlmClient(config),
    defaultResourceLimits: { cpu_limit: config.SANDBOX_CPU_LIMIT, memory_limit: config.SANDBOX_MEMORY_LIMIT },
    verifier: sandbox.runner,
    maxRepairAttempts: options.maxRepairAttempts ?? config.MAX_REPAIR_ATTEMPTS,
  });

  return {
    engine,
    info: {
      provider: config.LLM_PROVIDER,
      model: config.LLM_PROVIDER === "ollama" ? config.OLLAMA_MODEL : null,
      sandbox: { mode: sandbox.mode, available: sandbox.available, note: sandbox.note },
    },
  };
}
