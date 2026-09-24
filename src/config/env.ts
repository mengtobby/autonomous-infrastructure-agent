import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  /** `ollama` drafts with a local model; `replay` serves recorded drafts for
   * the built-in demo scenarios (no GPU or model needed). */
  LLM_PROVIDER: z.enum(["ollama", "replay"]).default("ollama"),
  REPLAY_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(700),
  /** How many times the agent may feed a failed verification back to the
   * model for a repaired draft before giving up. */
  MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  SANDBOX_MODE: z.enum(["docker", "local", "off"]).default("docker"),
  /** `local` runs generated commands directly on this machine, so it only
   * activates when explicitly acknowledged. */
  SANDBOX_LOCAL_ACKNOWLEDGE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5-coder:7b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  OLLAMA_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SANDBOX_CPU_LIMIT: z.string().min(1).default("0.5"),
  SANDBOX_MEMORY_LIMIT: z.string().min(1).default("256m"),
  SANDBOX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

/** Parses and validates process.env once, caching the result. Everything
 * here has a sane local default, so this never throws for a missing
 * environment variable — Ollama connectivity failures surface naturally
 * as request errors at the point the LLM is actually called. */
export function loadConfig(): AppConfig {
  if (!cachedConfig) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cachedConfig = parsed.data;
  }
  return cachedConfig;
}

/** Test-only hook to reset the memoized config between test cases. */
export function _resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}
