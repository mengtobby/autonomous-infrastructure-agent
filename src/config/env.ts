import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SANDBOX_CPU_LIMIT: z.string().min(1).default("0.5"),
  SANDBOX_MEMORY_LIMIT: z.string().min(1).default("256m"),
  SANDBOX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | undefined;

/** Parses and validates process.env once, caching the result. Never throws
 * for a missing ANTHROPIC_API_KEY here — that failure is deferred to the
 * point of use (loadConfig().requireAnthropicApiKey()) so commands that
 * don't need the LLM (e.g. policy-only dry runs) keep working without it. */
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

export function requireAnthropicApiKey(config: AppConfig): string {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env file (see .env.example) before running LLM-backed commands."
    );
  }
  return config.ANTHROPIC_API_KEY;
}

/** Test-only hook to reset the memoized config between test cases. */
export function _resetConfigCacheForTests(): void {
  cachedConfig = undefined;
}
