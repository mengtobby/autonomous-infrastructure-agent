import type { AppConfig } from "./env.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Returns why this configuration is unsafe to start, or null if it is fine.
 *
 * A real model drafts arbitrary commands, and the `local` sandbox runs them
 * straight on this machine with no isolation. Combined with a network-reachable
 * listener that is remote code execution for whoever can reach the port
 * (visitors can start runs with their own incidents). Replay mode only runs
 * recorded drafts, so it is fine to expose. */
export function exposureProblem(config: Pick<AppConfig, "HOST" | "LLM_PROVIDER" | "SANDBOX_MODE">): string | null {
  if (LOOPBACK_HOSTS.has(config.HOST)) {
    return null;
  }
  if (config.LLM_PROVIDER === "ollama" && config.SANDBOX_MODE === "local") {
    return (
      `Refusing to listen on ${config.HOST}: a live model with SANDBOX_MODE=local would let anyone who can reach ` +
      "this port run model-written commands on this machine. Use SANDBOX_MODE=docker, LLM_PROVIDER=replay, or HOST=127.0.0.1."
    );
  }
  return null;
}
