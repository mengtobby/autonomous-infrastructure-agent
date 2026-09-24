import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp, type AppDeps } from "../src/server.js";
import type { RemediateOptions, RemediationEngine } from "../src/core/remediationEngine.js";
import { RunManager } from "../src/runs/runManager.js";
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
  verdict: "VERIFIED",
  attempts: [],
};

/** An engine that emits a realistic event sequence, then resolves. */
function fakeEngine(overrides: Partial<RemediationEngine> = {}): RemediationEngine {
  return {
    remediate: vi.fn(async (_incident, options: RemediateOptions = {}) => {
      options.onEvent?.({ type: "policy_checked", policy: samplePlan.policy_check });
      options.onEvent?.({ type: "run_finished", plan: samplePlan });
      return samplePlan;
    }),
    ...overrides,
  } as unknown as RemediationEngine;
}

const info: AppDeps["info"] = {
  provider: "replay",
  model: null,
  sandbox: { mode: "local", available: true, note: "Local process sandbox" },
};

function buildTestApp(engine: RemediationEngine = fakeEngine(), extra: Partial<AppDeps> = {}) {
  const runs = new RunManager({ engine });
  const app = buildApp({ engine, runs, info, maxRepairAttempts: 2, publicDir: tmpdir(), ...extra });
  return { app, runs, engine };
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await request(buildTestApp().app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /incidents", () => {
  it("returns the remediation plan for a valid incident", async () => {
    const { app, engine } = buildTestApp();

    const res = await request(app).post("/incidents").send(validIncidentBody);

    expect(res.status).toBe(200);
    expect(res.body.incident_id).toBe("INC-1");
    expect(engine.remediate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a malformed incident payload", async () => {
    const res = await request(buildTestApp().app).post("/incidents").send({ incident_id: "INC-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_incident_alert");
  });

  it("returns 502 when the remediation pipeline throws", async () => {
    const { app } = buildTestApp(fakeEngine({ remediate: vi.fn().mockRejectedValue(new Error("boom")) }));

    const res = await request(app).post("/incidents").send(validIncidentBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("remediation_pipeline_failed");
  });
});

describe("unmatched routes", () => {
  it("returns 404 JSON", async () => {
    const res = await request(buildTestApp().app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });
});

describe("malformed request bodies", () => {
  it("returns a JSON error, not an HTML stack trace, for unparseable JSON", async () => {
    const res = await request(buildTestApp().app).post("/incidents").set("content-type", "application/json").send("{ not valid json");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: "invalid_json_body" });
    expect(res.text).not.toMatch(/<html/i);
  });

  it("returns a JSON error for a payload over the size limit", async () => {
    const res = await request(buildTestApp().app)
      .post("/incidents")
      .send({ ...validIncidentBody, error_log: "x".repeat(300_000) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });

  it("applies the same JSON error contract to the runs endpoint", async () => {
    const res = await request(buildTestApp().app).post("/api/runs").set("content-type", "application/json").send("{ nope");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json_body" });
  });
});

describe("GET /api/meta and /api/scenarios", () => {
  it("reports the provider, sandbox and version", async () => {
    const res = await request(buildTestApp().app).get("/api/meta");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "replay", model: null, maxRepairAttempts: 2, sandbox: { mode: "local", available: true } });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("lists scenarios without leaking the recorded drafts or the expected outcome", async () => {
    const res = await request(buildTestApp().app).get("/api/scenarios");

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    for (const scenario of res.body) {
      expect(Object.keys(scenario).sort()).toEqual(["blurb", "id", "incident", "tags", "title"]);
    }
  });
});

describe("POST /api/runs", () => {
  it("starts a run from a built-in scenario and returns 202 with its id", async () => {
    const { app, runs } = buildTestApp();

    const res = await request(app).post("/api/runs").send({ scenario_id: "telemetry-exporter" });
    await runs.whenIdle();

    expect(res.status).toBe(202);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const run = await request(app).get(`/api/runs/${res.body.id}`);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("finished");
    expect(run.body.scenarioId).toBe("telemetry-exporter");
    expect(run.body.plan.verdict).toBe("VERIFIED");
  });

  it("starts a run from a custom incident", async () => {
    const { app, runs, engine } = buildTestApp();

    const res = await request(app).post("/api/runs").send({ incident: validIncidentBody });
    await runs.whenIdle();

    expect(res.status).toBe(202);
    expect(engine.remediate).toHaveBeenCalledWith(validIncidentBody, expect.anything());
  });

  it("returns 404 for an unknown scenario", async () => {
    const res = await request(buildTestApp().app).post("/api/runs").send({ scenario_id: "nope" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unknown_scenario");
  });

  it.each([
    ["an empty body", {}],
    ["both a scenario and an incident", { scenario_id: "telemetry-exporter", incident: validIncidentBody }],
    ["an invalid incident", { incident: { incident_id: "x" } }],
    ["an unknown field", { scenario_id: "telemetry-exporter", extra: 1 }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await request(buildTestApp().app).post("/api/runs").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_run_request");
  });

  it("returns 429 when too many runs are already in progress", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const engine = fakeEngine({ remediate: vi.fn(async () => (await gate, samplePlan)) });
    const runs = new RunManager({ engine, maxConcurrent: 1 });
    const app = buildApp({ engine, runs, info, maxRepairAttempts: 2, publicDir: tmpdir() });

    const first = await request(app).post("/api/runs").send({ scenario_id: "token-bucket" });
    const second = await request(app).post("/api/runs").send({ scenario_id: "token-bucket" });
    release();
    await runs.whenIdle();

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    expect(second.body.error).toBe("too_many_runs");
  });
});

describe("run queries", () => {
  it("lists runs and reports stats", async () => {
    const { app, runs } = buildTestApp();
    await request(app).post("/api/runs").send({ scenario_id: "token-bucket" });
    await runs.whenIdle();

    const list = await request(app).get("/api/runs");
    const stats = await request(app).get("/api/stats");

    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ scenarioId: "token-bucket", verdict: "VERIFIED", status: "finished" });
    expect(stats.body).toMatchObject({ total: 1, running: 0 });
    expect(stats.body.byVerdict.VERIFIED).toBe(1);
  });

  it.each(["not-a-uuid", "../../etc/passwd", "00000000-0000-0000-0000-000000000000"])("returns 404 for run id %s", async (id) => {
    const { app } = buildTestApp();
    expect((await request(app).get(`/api/runs/${encodeURIComponent(id)}`)).status).toBe(404);
    expect((await request(app).get(`/api/runs/${encodeURIComponent(id)}/events`)).status).toBe(404);
  });
});

describe("GET /api/runs/:id/events (Server-Sent Events)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(app: ReturnType<typeof buildTestApp>["app"]): Promise<string> {
    server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, () => resolve(started));
    });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function readStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) return text;
      text += decoder.decode(chunk.value);
    }
  }

  it("streams the run's events as SSE and ends the stream after the verdict", async () => {
    const { app, runs } = buildTestApp();
    const base = await listen(app);
    const { id } = (await (await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: "token-bucket" }),
    })).json()) as { id: string };

    const response = await fetch(`${base}/api/runs/${id}/events`);
    const text = await readStream(response);
    await runs.whenIdle();

    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(text).toContain("event: pipeline");
    expect(text).toContain('"type":"policy_checked"');
    expect(text).toContain('"type":"run_finished"');
    expect(text).toMatch(/id: 1\n/);
  });

  it("resumes after Last-Event-ID without resending earlier events", async () => {
    const { app, runs } = buildTestApp();
    const base = await listen(app);
    const { id } = (await (await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: "token-bucket" }),
    })).json()) as { id: string };
    await runs.whenIdle();

    const response = await fetch(`${base}/api/runs/${id}/events`, { headers: { "last-event-id": "1" } });
    const text = await readStream(response);

    expect(text).not.toContain('"type":"policy_checked"');
    expect(text).toContain('"type":"run_finished"');
  });

  it("ends the stream with a run_failed event when the engine throws", async () => {
    const engine = fakeEngine({ remediate: vi.fn().mockRejectedValue(new Error("model unavailable")) });
    const { app, runs } = buildTestApp(engine);
    const base = await listen(app);
    const { id } = (await (await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: "token-bucket" }),
    })).json()) as { id: string };

    const text = await readStream(await fetch(`${base}/api/runs/${id}/events`));
    await runs.whenIdle();

    expect(text).toContain('"type":"run_failed"');
    expect(text).toContain("model unavailable");
  });
});

describe("static dashboard", () => {
  it("serves index.html from the public directory at /", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>dash</title>");
    try {
      const { app } = buildTestApp(fakeEngine(), { publicDir: dir });

      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>dash</title>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not serve files outside the public directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-"));
    try {
      const { app } = buildTestApp(fakeEngine(), { publicDir: dir });

      const res = await request(app).get("/..%2f..%2fetc%2fpasswd");

      expect([400, 403, 404]).toContain(res.status);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not send upgrade-insecure-requests, which breaks Safari on http://localhost", async () => {
    const res = await request(buildTestApp().app).get("/healthz");

    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["content-security-policy"]).not.toMatch(/upgrade-insecure-requests/);
    expect(res.headers["content-security-policy"]).toMatch(/script-src 'self'/);
  });
});
