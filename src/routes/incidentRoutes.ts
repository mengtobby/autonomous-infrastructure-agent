import { Router, type Request, type Response } from "express";
import { incidentAlertSchema } from "../schemas/incident.schema.js";
import type { RemediationEngine } from "../core/remediationEngine.js";
import { logger } from "../logging/logger.js";

export function buildIncidentRouter(engine: RemediationEngine): Router {
  const router = Router();

  router.post("/incidents", async (req: Request, res: Response) => {
    const parsed = incidentAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_incident_alert",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }

    try {
      const plan = await engine.remediate(parsed.data);
      res.status(200).json(plan);
    } catch (error) {
      logger.error({ err: error, incidentId: parsed.data.incident_id }, "Remediation pipeline failed");
      res.status(502).json({ error: "remediation_pipeline_failed" });
    }
  });

  return router;
}
