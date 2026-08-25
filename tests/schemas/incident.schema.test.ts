import { describe, expect, it } from "vitest";
import { incidentAlertSchema } from "../../src/schemas/incident.schema.js";

const validIncident = {
  incident_id: "INC-20260815-TEL-01",
  service_name: "telemetry-collector",
  timestamp: "2026-08-15T19:00:00Z",
  target_file_path: "/app/collectors/metrics_exporter.py",
  error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
  service_requirements_context: "Requires a PrometheusMetricsExporter class.",
};

describe("incidentAlertSchema", () => {
  it("accepts a well-formed incident alert", () => {
    expect(() => incidentAlertSchema.parse(validIncident)).not.toThrow();
  });

  it("rejects a missing incident_id", () => {
    const { incident_id: _drop, ...withoutId } = validIncident;
    expect(() => incidentAlertSchema.parse(withoutId)).toThrow();
  });

  it("rejects a non-ISO timestamp", () => {
    expect(() => incidentAlertSchema.parse({ ...validIncident, timestamp: "not-a-date" })).toThrow();
  });

  it("accepts a timestamp with a numeric UTC offset, not just a literal Z suffix", () => {
    expect(() => incidentAlertSchema.parse({ ...validIncident, timestamp: "2026-08-15T19:00:00+00:00" })).not.toThrow();
    expect(() => incidentAlertSchema.parse({ ...validIncident, timestamp: "2026-08-15T15:00:00-04:00" })).not.toThrow();
  });

  it("rejects an empty error_log", () => {
    expect(() => incidentAlertSchema.parse({ ...validIncident, error_log: "" })).toThrow();
  });
});
