import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { RemediationEngine } from "../../src/core/remediationEngine.js";
import { demoScenarios, findScenario } from "../../src/demo/scenarios/index.js";
import { incidentAlertSchema } from "../../src/schemas/incident.schema.js";
import { ReplayLlmClient } from "../../src/llm/replayClient.js";
import { LocalSandboxRunner } from "../../src/sandbox/localSandboxRunner.js";
import { ProcessCommandRunner } from "../../src/sandbox/processCommandRunner.js";
import { lintDraft } from "../../src/core/draftLint.js";

/** Probed through a shell, exactly as the local sandbox runs commands (this matters on
 * Windows, where tools like pyenv expose python as a .bat shim that only a shell can run). */
const hasBinary = (name: string): boolean => spawnSync(`${name} --version`, { shell: true, stdio: "ignore" }).status === 0;
const hasPython = hasBinary("python");

function buildEngine(): RemediationEngine {
  return new RemediationEngine({
    llmClient: new ReplayLlmClient({ scenarios: demoScenarios }),
    defaultResourceLimits: { cpu_limit: "0.5", memory_limit: "256m" },
    verifier: new LocalSandboxRunner({ commandRunner: new ProcessCommandRunner(), timeoutSeconds: 30 }),
    maxRepairAttempts: 2,
  });
}

describe("demo scenario catalogue", () => {
  it("has unique ids and valid incidents", () => {
    const ids = demoScenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    const incidentIds = demoScenarios.map((scenario) => scenario.incident.incident_id);
    expect(new Set(incidentIds).size).toBe(incidentIds.length);

    for (const scenario of demoScenarios) {
      expect(incidentAlertSchema.safeParse(scenario.incident).success, scenario.id).toBe(true);
    }
  });

  it("finds a scenario by id", () => {
    expect(findScenario("telemetry-exporter")?.title).toMatch(/exporter/i);
    expect(findScenario("nope")).toBeUndefined();
  });

  it("records drafts only for scenarios the gate lets through", () => {
    for (const scenario of demoScenarios) {
      const blocked = scenario.expectedVerdict === "BLOCKED";
      expect(scenario.recordedDrafts.length === 0, scenario.id).toBe(blocked);
    }
  });

  it("every recorded draft passes the static linter (the flawed first draft fails only in the sandbox)", () => {
    for (const scenario of demoScenarios) {
      scenario.recordedDrafts.forEach((draft, index) => {
        expect(lintDraft(draft, scenario.incident.target_file_path), `${scenario.id} draft ${index}`).toEqual([]);
      });
    }
  });
});

describe.skipIf(!hasPython)("demo scenarios end-to-end (real replay provider + real local sandbox)", () => {
  it.each(demoScenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s ends in its expected verdict",
    async (_id, scenario) => {
      const plan = await buildEngine().remediate(scenario.incident);

      expect(plan.verdict, plan.verification_note ?? "").toBe(scenario.expectedVerdict);
    },
    60_000
  );

  it("telemetry-exporter: the first draft really fails in the sandbox, and the repair really passes", async () => {
    const scenario = findScenario("telemetry-exporter");
    if (!scenario) throw new Error("scenario missing");

    const plan = await buildEngine().remediate(scenario.incident);

    expect(plan.attempts).toHaveLength(2);
    const [first, second] = plan.attempts ?? [];
    expect(first?.kind).toBe("initial");
    expect(first?.passed).toBe(false);
    expect(first?.sandbox_run_result?.exit_code).not.toBe(0);
    expect(first?.sandbox_run_result?.stderr).toMatch(/AssertionError/);
    expect(first?.sandbox_run_result?.stderr).toMatch(/cpu_usage\{host=srv1\}/);
    expect(second?.kind).toBe("repair");
    expect(second?.passed).toBe(true);
    expect(second?.sandbox_run_result?.stdout).toContain("VERIFIED");
    expect(plan.remediation.full_file_content).toContain('{key}="{_escape_label_value(val)}"');
  }, 60_000);

  it("blocked scenarios never reach the model or the sandbox", async () => {
    for (const id of ["prompt-injection", "system-path"]) {
      const scenario = findScenario(id);
      if (!scenario) throw new Error(`scenario ${id} missing`);

      const plan = await buildEngine().remediate(scenario.incident);

      expect(plan.verdict, id).toBe("BLOCKED");
      expect(plan.attempts, id).toEqual([]);
      expect(plan.remediation.full_file_content, id).toBe("");
    }
  });

  it("the prompt-injection scenario stays HIGH risk no matter what the alert text claims", async () => {
    const scenario = findScenario("prompt-injection");
    if (!scenario) throw new Error("scenario missing");

    const plan = await buildEngine().remediate(scenario.incident);

    expect(scenario.incident.error_log).toMatch(/Ignore all previous instructions/i);
    expect(plan.policy_check.risk_level).toBe("HIGH");
    expect(plan.policy_check.is_safe_to_remediate).toBe(false);
  });
});
