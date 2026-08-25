import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../src/server.js";
import type { RemediationEngine } from "../src/core/remediationEngine.js";
import type { RemediationPlan } from "../src/schemas/remediation.schema.js";

const validIncidentBody = {
  incident_id: "INC-1",
  service_name: "telemetry-collector",
  timestamp: "2026-08-15T19:00:00Z",
  target_file_path: "/app/collectors/metrics_exporter.py",
  error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
  service_requirements_context: "Requires a PrometheusMetricsExporter class.",
};

const samplePlan: RemediationPlan = {
  incident_id: "INC-1",
  service_name: "telemetry-collector",
  target_file_path: "/app/collectors/metrics_exporter.py",
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  policy_check: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary module" },
  remediation: { action: "CREATE_FILE", module_summary: "s", full_file_content: "print('hi')\n" },
  sandbox_verification: {
    container_image: "python:3.11-slim",
    resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
    test_commands: ["echo ok"],
    expected_output_pattern: "ok",
  },
  sandbox_run_result: null,
};

function fakeEngine(overrides: Partial<RemediationEngine> = {}): RemediationEngine {
  return { remediate: vi.fn().mockResolvedValue(samplePlan), ...overrides } as unknown as RemediationEngine;
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const app = buildApp(fakeEngine());
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /incidents", () => {
  it("returns the remediation plan for a valid incident", async () => {
    const engine = fakeEngine();
    const app = buildApp(engine);

    const res = await request(app).post("/incidents").send(validIncidentBody);

    expect(res.status).toBe(200);
    expect(res.body.incident_id).toBe("INC-1");
    expect(engine.remediate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a malformed incident payload", async () => {
    const app = buildApp(fakeEngine());
    const res = await request(app).post("/incidents").send({ incident_id: "INC-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_incident_alert");
  });

  it("returns 502 when the remediation pipeline throws", async () => {
    const engine = fakeEngine({ remediate: vi.fn().mockRejectedValue(new Error("boom")) });
    const app = buildApp(engine);

    const res = await request(app).post("/incidents").send(validIncidentBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("remediation_pipeline_failed");
  });
});

describe("unmatched routes", () => {
  it("returns 404", async () => {
    const app = buildApp(fakeEngine());
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
  });
});

describe("malformed request bodies", () => {
  it("returns a JSON error, not an HTML stack trace, for unparseable JSON", async () => {
    const app = buildApp(fakeEngine());

    const res = await request(app).post("/incidents").set("content-type", "application/json").send("{ not valid json");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "invalid_json_body" });
    expect(res.text).not.toMatch(/<html/i);
  });

  it("returns a JSON error for a payload over the size limit", async () => {
    const app = buildApp(fakeEngine());
    const oversizedBody = { ...validIncidentBody, error_log: "x".repeat(300_000) };

    const res = await request(app).post("/incidents").send(oversizedBody);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });
});
