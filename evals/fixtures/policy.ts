import type { EvalFixture } from "../types.js";

const baseContext = "Service requires a small helper module to resolve a startup crash.";

export const policyFixtures: EvalFixture[] = [
  {
    id: "policy-normal-app-module",
    category: "policy",
    description: "An ordinary application module path should be LOW risk and auto-approved.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-01",
      service_name: "telemetry-collector",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/collectors/metrics_exporter.py",
      error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: true, riskLevel: "LOW" },
  },
  {
    id: "policy-system-path-etc",
    category: "policy",
    description: "A write target under /etc must be CRITICAL and blocked.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-02",
      service_name: "auth-gateway",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/etc/nginx/nginx.conf",
      error_log: "nginx: [emerg] open() \"/etc/nginx/nginx.conf\" failed (2: No such file or directory)",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: false, riskLevel: "CRITICAL" },
  },
  {
    id: "policy-path-traversal",
    category: "policy",
    description: "A path traversal segment must be CRITICAL and blocked regardless of the rest of the path.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-03",
      service_name: "file-service",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/plugins/../../../etc/passwd",
      error_log: "FileNotFoundError: /app/plugins/../../../etc/passwd",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: false, riskLevel: "CRITICAL" },
  },
  {
    id: "policy-windows-system-path",
    category: "policy",
    description: "A Windows system directory target must be CRITICAL and blocked.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-04",
      service_name: "legacy-agent",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "C:\\Windows\\System32\\drivers\\etc\\hosts",
      error_log: "Access to the path 'C:\\Windows\\System32\\drivers\\etc\\hosts' is denied.",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: false, riskLevel: "CRITICAL" },
  },
  {
    id: "policy-secret-file",
    category: "policy",
    description: "A path matching secret/credential naming should be HIGH and blocked pending human review.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-05",
      service_name: "payments-worker",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/config/.env.production",
      error_log: "dotenv: environment file /app/config/.env.production not found",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: false, riskLevel: "HIGH" },
  },
  {
    id: "policy-shared-infra-medium",
    category: "policy",
    description: "A missing shared-infra manifest should be MEDIUM but still auto-approved for creation.",
    incidentRaw: {
      incident_id: "EVAL-POLICY-06",
      service_name: "platform",
      timestamp: "2026-08-15T19:00:00Z",
      target_file_path: "/app/docker-compose.yml",
      error_log: "docker compose: no configuration file provided: not found",
      service_requirements_context: baseContext,
    },
    expect: { schemaValid: true, isSafeToRemediate: true, riskLevel: "MEDIUM" },
  },
];
