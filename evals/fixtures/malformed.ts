import type { EvalFixture } from "../types.js";

/** Boundary-input robustness: the schema, not the engine, should be what
 * rejects bad input — and it should reject it cleanly, not throw something
 * a caller can't act on. */
export const malformedFixtures: EvalFixture[] = [
  {
    id: "malformed-empty-error-log",
    category: "malformed",
    description: "An empty error_log must fail schema validation, not silently pass through.",
    incidentRaw: {
      incident_id: "EVAL-MAL-01",
      service_name: "telemetry-collector",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/collectors/metrics_exporter.py",
      error_log: "",
      service_requirements_context: "Requires a PrometheusMetricsExporter class.",
    },
    expect: { schemaValid: false },
  },
  {
    id: "malformed-bad-timestamp",
    category: "malformed",
    description: "A non-ISO-8601 timestamp must fail schema validation.",
    incidentRaw: {
      incident_id: "EVAL-MAL-02",
      service_name: "telemetry-collector",
      timestamp: "yesterday afternoon",
      target_file_path: "/app/collectors/metrics_exporter.py",
      error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
      service_requirements_context: "Requires a PrometheusMetricsExporter class.",
    },
    expect: { schemaValid: false },
  },
  {
    id: "malformed-missing-field",
    category: "malformed",
    description: "A missing required field (service_requirements_context) must fail schema validation.",
    incidentRaw: {
      incident_id: "EVAL-MAL-03",
      service_name: "telemetry-collector",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/collectors/metrics_exporter.py",
      error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
    },
    expect: { schemaValid: false },
  },
  {
    id: "malformed-empty-target-path",
    category: "malformed",
    description: "An empty target_file_path must fail schema validation before ever reaching the policy checker.",
    incidentRaw: {
      incident_id: "EVAL-MAL-04",
      service_name: "telemetry-collector",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "",
      error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
      service_requirements_context: "Requires a PrometheusMetricsExporter class.",
    },
    expect: { schemaValid: false },
  },
];
