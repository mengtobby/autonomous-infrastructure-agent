import { Router, type Request, type RequestHandler, type Response } from "express";
import { incidentAlertSchema } from "../schemas/incident.schema.js";
import { TooManyRunsError, type RunManager } from "../runs/runManager.js";
import { logger } from "../logging/logger.js";

/** Synchronous webhook: submit an incident, get the finished plan back. It goes
 * through the RunManager so it shares the concurrency cap with the dashboard
 * and shows up in run history. For live progress use the /api/runs endpoints. */
export function buildIncidentRouter(runs: RunManager, limiter: RequestHandler): Router {
  const router = Router();

  router.post("/incidents", limiter, async (req: Request, res: Response) => {
    const parsed = incidentAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_incident_alert",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }

    try {
      const started = runs.start(parsed.data);
      const finished = await runs.completion(started.id);
      if (finished?.plan) {
        res.status(200).json(finished.plan);
        return;
      }
      logger.error({ incidentId: parsed.data.incident_id, runId: started.id }, "Remediation pipeline failed");
      res.status(502).json({ error: "remediation_pipeline_failed" });
    } catch (error) {
      if (error instanceof TooManyRunsError) {
        res.status(429).json({ error: "too_many_runs", message: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}
