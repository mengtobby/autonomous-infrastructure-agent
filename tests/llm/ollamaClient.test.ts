import { describe, expect, it, vi } from "vitest";
import { OllamaLlmClient } from "../../src/llm/ollamaClient.js";
import type { IncidentAlert } from "../../src/schemas/incident.schema.js";
import type { PolicyCheck } from "../../src/schemas/remediation.schema.js";

const incident: IncidentAlert = {
  incident_id: "INC-1",
  service_name: "telemetry-collector",
  timestamp: "2026-08-15T19:00:00Z",
  target_file_path: "/app/collectors/metrics_exporter.py",
  error_log: "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
  service_requirements_context: "Requires a PrometheusMetricsExporter class.",
};

const policyCheck: PolicyCheck = { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: "ordinary module" };

const validDraft = {
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  module_summary: "s",
  full_file_content: "print('hi')\n",
  container_image: "python:3.11-slim",
  test_commands: ["echo ok"],
  expected_output_pattern: "ok",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function chatResponse(content: string): Response {
  return jsonResponse({ message: { content } });
}

describe("OllamaLlmClient", () => {
  it("posts to /api/chat with a JSON-schema format and parses a valid response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(validDraft)));
    const client = new OllamaLlmClient({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
      fetchImpl,
    });

    const draft = await client.generateRemediationDraft(incident, policyCheck);

    expect(draft.full_file_content).toBe("print('hi')\n");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("qwen2.5-coder:7b");
    expect(body.format).toBeTypeOf("object");
    expect(body.stream).toBe(false);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(validDraft)));
    const client = new OllamaLlmClient({ baseUrl: "http://localhost:11434/", model: "m", fetchImpl });

    await client.generateRemediationDraft(incident, policyCheck);

    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
  });

  it("retries on malformed JSON content, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("not json"))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validDraft)));

    const client = new OllamaLlmClient({ baseUrl: "http://localhost:11434", model: "m", maxAttempts: 2, fetchImpl });

    const draft = await client.generateRemediationDraft(incident, policyCheck);

    expect(draft.full_file_content).toBe("print('hi')\n");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a helpful error after exhausting retries on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "model not found" }, false, 404));
    const client = new OllamaLlmClient({ baseUrl: "http://localhost:11434", model: "missing-model", maxAttempts: 2, fetchImpl });

    await expect(client.generateRemediationDraft(incident, policyCheck)).rejects.toThrow(
      /ollama pull missing-model/
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the response is missing message content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new OllamaLlmClient({ baseUrl: "http://localhost:11434", model: "m", maxAttempts: 1, fetchImpl });

    await expect(client.generateRemediationDraft(incident, policyCheck)).rejects.toThrow();
  });
});
