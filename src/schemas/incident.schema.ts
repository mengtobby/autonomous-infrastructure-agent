import { z } from "zod";

export const incidentAlertSchema = z.object({
  incident_id: z.string().min(1, "incident_id is required"),
  service_name: z.string().min(1, "service_name is required"),
  timestamp: z.string().datetime({ offset: true, message: "timestamp must be an ISO-8601 datetime" }),
  target_file_path: z.string().min(1, "target_file_path is required"),
  error_log: z.string().min(1, "error_log is required"),
  service_requirements_context: z.string().min(1, "service_requirements_context is required"),
});

export type IncidentAlert = z.infer<typeof incidentAlertSchema>;
