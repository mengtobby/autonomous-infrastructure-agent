/**
 * `npm run demo`: starts the dashboard with everything needed to show the
 * full pipeline on a laptop — recorded model output, and a local sandbox that
 * really executes each draft — so it needs no GPU, no Ollama and no Docker.
 *
 * Anything already set in the environment (or .env) wins, so
 * `LLM_PROVIDER=ollama npm run demo` demos a live model instead.
 */
process.env.LLM_PROVIDER ??= "replay";
process.env.LOG_LEVEL ??= "warn";

// The local sandbox runs generated code with no isolation. That is fine for
// the recorded scenarios we wrote ourselves, but never something to switch on
// silently for a live model's output — that requires explicit consent.
if (process.env.LLM_PROVIDER === "replay") {
  process.env.SANDBOX_MODE ??= "local";
  process.env.SANDBOX_LOCAL_ACKNOWLEDGE ??= "true";
}

// Imported after the defaults above so config and the logger see them.
const { loadConfig } = await import("./config/env.js");
const { startServer } = await import("./server.js");

const config = loadConfig();
const server = await startServer(config);

process.stdout.write(
  [
    "",
    "  Autonomous Infra Agent",
    `  ▸ Dashboard   http://localhost:${config.PORT}`,
    `  ▸ Model       ${config.LLM_PROVIDER === "replay" ? "recorded drafts (replay mode)" : config.OLLAMA_MODEL}`,
    `  ▸ Sandbox     ${config.SANDBOX_MODE}`,
    "",
    "  Press Ctrl+C to stop.",
    "",
  ].join("\n")
);

const shutdown = (): void => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
