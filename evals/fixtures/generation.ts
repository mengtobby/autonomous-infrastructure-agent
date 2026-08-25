import type { EvalFixture } from "../types.js";

/** These fixtures call the real LLM (gated behind --generate, since each
 * call is a real inference request) and grade the drafted content, not
 * just the JSON shape. `mustNotMatch` targets the most common local-model
 * failure mode observed in manual testing: emitting the file content as an
 * escaped JSON string describing the code instead of the code itself. */
export const generationFixtures: EvalFixture[] = [
  {
    id: "generation-python-module",
    category: "generation",
    description: "A missing Python module should be drafted as real, importable Python source.",
    incidentRaw: {
      incident_id: "EVAL-GEN-01",
      service_name: "telemetry-collector",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/collectors/metrics_exporter.py",
      error_log:
        "ModuleNotFoundError: No module named 'collectors.metrics_exporter'\n" +
        'File "/app/main.py", line 12, in <module>\n' +
        "from collectors.metrics_exporter import PrometheusMetricsExporter\n" +
        "CRITICAL:worker: Failed to initialize metrics exporter. Exiting with status 1.",
      service_requirements_context:
        "Service requires a PrometheusMetricsExporter class with an export_gauge(name: str, value: float, " +
        "labels: dict) method and a get_metrics() method returning Prometheus-formatted text strings.",
    },
    expect: {
      schemaValid: true,
      isSafeToRemediate: true,
      riskLevel: "LOW",
      action: "CREATE_FILE",
      content: {
        mustContain: ["class ", "def "],
        mustNotMatch: [/^\s*\{\s*"class"\s*:/, /^\s*\{\s*"init"\s*:/],
        minLength: 60,
      },
    },
  },
  {
    id: "generation-typescript-module",
    category: "generation",
    description: "A missing TypeScript utility should be drafted as real, importable TS source.",
    incidentRaw: {
      incident_id: "EVAL-GEN-02",
      service_name: "articles-api",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/src/utils/slugify.ts",
      error_log:
        "Error: Cannot find module '/app/src/utils/slugify.ts' imported from /app/src/routes/articles.ts\n" +
        "at Object.<anonymous> (/app/src/routes/articles.ts:4:24)",
      service_requirements_context:
        "Export a slugify(input: string): string function that lowercases the input, trims whitespace, " +
        "replaces runs of whitespace with a single hyphen, and strips characters that are not alphanumeric or hyphens.",
    },
    expect: {
      schemaValid: true,
      isSafeToRemediate: true,
      riskLevel: "LOW",
      action: "CREATE_FILE",
      content: {
        mustContain: ["export"],
        mustContainAnyOf: ["function", "=>"],
        mustNotMatch: [/^\s*\{\s*"function"\s*:/],
        minLength: 40,
      },
    },
  },
];
