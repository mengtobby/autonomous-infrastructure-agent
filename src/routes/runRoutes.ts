import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RuntimeInfo } from "../app/createRuntime.js";
import type { DemoScenario } from "../demo/types.js";
import { incidentAlertSchema } from "../schemas/incident.schema.js";
import { RunManager, TooManyRunsError, type RunEvent } from "../runs/runManager.js";
import { openEventStream } from "./eventStream.js";
import { VERSION } from "../version.js";

export interface RunRoutesDeps {
  runs: RunManager;
  info: RuntimeInfo;
  scenarios: readonly DemoScenario[];
  maxRepairAttempts: number;
  /** Applied to the routes that start work, so a client can't flood the model. */
  startRunLimiter: (req: Request, res: Response, next: () => void) => void;
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const startRunSchema = z.union([
  z.object({ scenario_id: z.string().min(1) }).strict(),
  z.object({ incident: incidentAlertSchema }).strict(),
]);

const isTerminal = (event: RunEvent): boolean => event.type === "run_finished" || event.type === "run_failed";

export function buildRunRouter(deps: RunRoutesDeps): Router {
  const router = Router();
  const { runs, scenarios } = deps;

  router.get("/api/meta", (_req, res) => {
    res.json({ version: VERSION, ...deps.info, maxRepairAttempts: deps.maxRepairAttempts });
  });

  router.get("/api/scenarios", (_req, res) => {
    // Recorded drafts and the expected verdict stay server-side: the client
    // gets to watch the outcome rather than read it.
    res.json(
      scenarios.map(({ id, title, blurb, tags, incident }) => ({ id, title, blurb, tags, incident }))
    );
  });

  router.get("/api/stats", (_req, res) => {
    res.json(runs.stats());
  });

  router.get("/api/runs", (_req, res) => {
    res.json(runs.list());
  });

  router.post("/api/runs", deps.startRunLimiter, (req, res) => {
    const parsed = startRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_run_request",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }

    let incident;
    let scenarioId: string | null = null;
    if ("scenario_id" in parsed.data) {
      const requestedId = parsed.data.scenario_id;
      const scenario = scenarios.find((candidate) => candidate.id === requestedId);
      if (!scenario) {
        res.status(404).json({ error: "unknown_scenario" });
        return;
      }
      incident = scenario.incident;
      scenarioId = scenario.id;
    } else {
      incident = parsed.data.incident;
    }

    try {
      const record = runs.start(incident, scenarioId);
      res.status(202).json({ id: record.id });
    } catch (error) {
      if (error instanceof TooManyRunsError) {
        res.status(429).json({ error: "too_many_runs", message: error.message });
        return;
      }
      throw error;
    }
  });

  router.get("/api/runs/:id", (req, res) => {
    const record = RUN_ID.test(req.params.id) ? runs.get(req.params.id) : undefined;
    if (!record) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }
    res.json(record);
  });

  router.get("/api/runs/:id/events", (req, res) => {
    const id = req.params.id;
    if (!RUN_ID.test(id) || !runs.get(id)) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }

    const stream = openEventStream(res);
    const lastEventId = Number.parseInt(req.header("last-event-id") ?? "", 10);

    let unsubscribe: (() => void) | undefined;
    const unsubscribeNow = (): void => unsubscribe?.();

    unsubscribe = runs.subscribe(
      id,
      (timed) => {
        stream.send(timed.seq, "pipeline", timed);
        if (isTerminal(timed.event)) {
          stream.close();
        }
      },
      Number.isFinite(lastEventId) ? lastEventId : 0
    );

    // The replay above can finish the stream before the subscription exists.
    if (stream.closed) {
      unsubscribeNow();
    }
    res.on("close", unsubscribeNow);
  });

  return router;
}
