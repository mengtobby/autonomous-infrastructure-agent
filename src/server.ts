import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createRuntime, type RuntimeInfo } from "./app/createRuntime.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import type { RemediationEngine } from "./core/remediationEngine.js";
import { demoScenarios } from "./demo/scenarios/index.js";
import { RunManager } from "./runs/runManager.js";
import { buildIncidentRouter } from "./routes/incidentRoutes.js";
import { buildRunRouter } from "./routes/runRoutes.js";
import { isMainModule } from "./isMainModule.js";
import { logger } from "./logging/logger.js";

/** The dashboard's static files. Resolved relative to this module so it works
 * from both src/ (tsx) and dist/ (compiled) — each sits one level below the root. */
const DEFAULT_PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface AppDeps {
  /** Backs the synchronous POST /incidents webhook. */
  engine: RemediationEngine;
  runs: RunManager;
  info: RuntimeInfo;
  maxRepairAttempts: number;
  publicDir?: string;
}

export function buildApp(deps: AppDeps): express.Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        // The default `upgrade-insecure-requests` makes Safari rewrite this
        // page's http://localhost requests to https, which breaks the dashboard.
        directives: { "upgrade-insecure-requests": null },
      },
    })
  );
  app.use(express.json({ limit: "256kb" }));

  // Only the endpoints that start work are limited; reads and the SSE stream aren't.
  const startWorkLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited" },
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(buildIncidentRouter(deps.engine, startWorkLimiter));
  app.use(
    buildRunRouter({
      runs: deps.runs,
      info: deps.info,
      scenarios: demoScenarios,
      maxRepairAttempts: deps.maxRepairAttempts,
      startRunLimiter: startWorkLimiter,
    })
  );

  app.use(express.static(deps.publicDir ?? DEFAULT_PUBLIC_DIR, { maxAge: 0 }));

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

export async function startServer(config: AppConfig = loadConfig()): Promise<Server> {
  const runtime = await createRuntime(config, { verify: config.SANDBOX_MODE !== "off" });
  const runs = new RunManager({ engine: runtime.engine });

  const app = buildApp({
    engine: runtime.engine,
    runs,
    info: runtime.info,
    maxRepairAttempts: config.MAX_REPAIR_ATTEMPTS,
  });

  if (config.SANDBOX_MODE !== "off" && !runtime.info.sandbox.available) {
    logger.warn({ sandbox: runtime.info.sandbox }, "Sandbox is not available; runs will end UNVERIFIED");
  }

  return new Promise<Server>((resolveServer, reject) => {
    const server = app.listen(config.PORT, () => {
      logger.info(
        { port: config.PORT, provider: runtime.info.provider, sandbox: runtime.info.sandbox.mode },
        `autonomous-infra-agent listening — dashboard at http://localhost:${config.PORT}`
      );
      resolveServer(server);
    });
    server.on("error", reject);
  });
}

function installShutdownHandlers(server: Server): void {
  const shutdown = (): void => {
    logger.info("Shutting down");
    // Open SSE streams would otherwise keep the process alive.
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  startServer()
    .then(installShutdownHandlers)
    .catch((error: unknown) => {
      logger.error({ err: error }, "Failed to start server");
      process.exitCode = 1;
    });
}
