import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config/env.js";
import { RemediationEngine } from "./core/remediationEngine.js";
import { OllamaLlmClient } from "./llm/ollamaClient.js";
import { buildIncidentRouter } from "./routes/incidentRoutes.js";
import { isMainModule } from "./isMainModule.js";
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
      message: { error: "rate_limited" },
    })
  );

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(buildIncidentRouter(engine));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Must be registered last and take 4 args (Express only treats a
  // handler as error-handling middleware if its arity is exactly 4).
  // Without this, a malformed/oversized JSON body throws inside
  // express.json() before any route handler runs, and Express's default
  // error handler returns an HTML page containing the full stack trace
  // and server file paths — breaking the API's JSON contract and leaking
  // internal details to the client.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const status = getClientErrorStatus(err);
    if (status) {
      res.status(status).json({ error: status === 413 ? "payload_too_large" : "invalid_json_body" });
      return;
    }

    logger.error({ err }, "Unhandled error in request pipeline");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

/** body-parser attaches a numeric `status` to the errors it throws for
 * malformed JSON (400) and oversized payloads (413) — anything else is an
 * unexpected server-side failure and must not be echoed back to the client. */
function getClientErrorStatus(err: unknown): number | undefined {
  if (err instanceof Error && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return status;
    }
  }
  return undefined;
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

if (isMainModule(process.argv[1], import.meta.url)) {
  main();
}
