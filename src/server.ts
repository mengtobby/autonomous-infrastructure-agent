import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config/env.js";
import { RemediationEngine } from "./core/remediationEngine.js";
import { OllamaLlmClient } from "./llm/ollamaClient.js";
import { buildIncidentRouter } from "./routes/incidentRoutes.js";
import { logger } from "./logging/logger.js";

export function buildApp(engine: RemediationEngine): express.Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(buildIncidentRouter(engine));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

function main(): void {
  const config = loadConfig();

  const llmClient = new OllamaLlmClient({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
    numCtx: config.OLLAMA_NUM_CTX,
    requestTimeoutMs: config.OLLAMA_REQUEST_TIMEOUT_SECONDS * 1000,
  });

  const engine = new RemediationEngine({
    llmClient,
    defaultResourceLimits: {
      cpu_limit: config.SANDBOX_CPU_LIMIT,
      memory_limit: config.SANDBOX_MEMORY_LIMIT,
    },
  });

  const app = buildApp(engine);

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "autonomous-infra-agent webhook server listening");
  });
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  main();
}
