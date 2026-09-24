import type { DemoScenario } from "../types.js";

const COMPOSE_SOURCE = `services:
  payments-api:
    image: registry.internal/payments-api:1.4.2
    ports:
      - "8080:8080"
    environment:
      LOG_LEVEL: info
      PORT: "8080"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
`;

const TEST_COMMAND =
  "python -c \"text = open('deploy/docker-compose.yml').read(); " +
  "assert 'services:' in text and 'healthcheck:' in text and 'restart:' in text, 'compose file is missing required sections'; " +
  "print('VERIFIED')\"";

export const deployComposeScenario: DemoScenario = {
  id: "deploy-compose",
  title: "Compose manifest missing — deploy pipeline aborts",
  blurb: "Shared infrastructure config: allowed, but the policy gate flags it MEDIUM risk and asks for human review.",
  tags: ["YAML", "MEDIUM risk", "flagged for review"],
  expectedVerdict: "VERIFIED",
  incident: {
    incident_id: "INC-20260924-PLT-03",
    service_name: "payments-api",
    timestamp: "2026-09-24T14:31:40Z",
    target_file_path: "/app/deploy/docker-compose.yml",
    error_log: [
      "deploy-step[3/5] docker compose -f deploy/docker-compose.yml up -d",
      "open /app/deploy/docker-compose.yml: no such file or directory",
      "pipeline aborted: deploy failed with exit code 14",
    ].join("\n"),
    service_requirements_context:
      "Create the compose manifest for payments-api: expose 8080, define a healthcheck against /healthz, restart " +
      "unless-stopped, run read-only with all capabilities dropped, and cap resources at 1 CPU / 512M.",
  },
  recordedDrafts: [
    {
      root_cause_analysis: {
        error_type: "FileNotFoundError",
        failing_component: "/app/deploy/docker-compose.yml",
        detailed_explanation:
          "The deploy step references deploy/docker-compose.yml, which was never committed, so the pipeline exits before " +
          "any container is started.",
      },
      module_summary: "Hardened compose service definition with healthcheck, restart policy and resource limits.",
      full_file_content: COMPOSE_SOURCE,
      container_image: "python:3.11-slim",
      test_commands: [TEST_COMMAND],
      expected_output_pattern: "VERIFIED",
    },
  ],
};
