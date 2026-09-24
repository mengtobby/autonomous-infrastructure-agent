import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { RemediationEngine } from "../../src/core/remediationEngine.js";
import type { RemediateOptions } from "../../src/core/remediationEngine.js";
import { demoScenarios } from "../../src/demo/scenarios/index.js";
import { ReplayLlmClient } from "../../src/llm/replayClient.js";
import { RunManager } from "../../src/runs/runManager.js";
import { LocalSandboxRunner } from "../../src/sandbox/localSandboxRunner.js";
import { ProcessCommandRunner } from "../../src/sandbox/processCommandRunner.js";
import type { RemediationPlan } from "../../src/schemas/remediation.schema.js";
import { buildApp } from "../../src/server.js";
import { findChromium, launch } from "./browser.js";

const chromiumPath = findChromium();
const hasPython = spawnSync("python --version", { shell: true, stdio: "ignore" }).status === 0;
const canRun = Boolean(chromiumPath) && hasPython;

const info = {
  provider: "replay" as const,
  model: null,
  sandbox: { mode: "local" as const, available: true, note: "Local process sandbox" },
};

function realEngine(): RemediationEngine {
  return new RemediationEngine({
    llmClient: new ReplayLlmClient({ scenarios: demoScenarios }),
    defaultResourceLimits: { cpu_limit: "0.5", memory_limit: "256m" },
    verifier: new LocalSandboxRunner({ commandRunner: new ProcessCommandRunner(), timeoutSeconds: 30 }),
    maxRepairAttempts: 2,
  });
}

async function serve(engine: RemediationEngine): Promise<{ server: Server; base: string }> {
  const runs = new RunManager({ engine });
  const app = buildApp({ engine, runs, info, maxRepairAttempts: 2 });
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

describe.skipIf(!canRun)("dashboard (real browser, real server, real sandbox)", () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  let context: BrowserContext;
  let page: Page;
  const problems: string[] = [];

  beforeAll(async () => {
    browser = await launch(chromiumPath as string);
    ({ server, base } = await serve(realEngine()));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (server) await close(server);
  });

  async function freshPage(viewport = { width: 1280, height: 900 }, colorScheme: "light" | "dark" = "light"): Promise<Page> {
    await context?.close();
    context = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce" });
    page = await context.newPage();
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) problems.push(`console.${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    return page;
  }

  it("loads the six incidents and states plainly what is real and what is replayed", async () => {
    await freshPage();
    await page.goto(base);
    await page.waitForSelector(".incident");

    expect(await page.locator(".incident").count()).toBe(6);
    await expect.poll(() => page.locator(".chip").allInnerTexts()).toEqual(["Recorded drafts", "Local sandbox · not isolated"]);
    expect(await page.textContent(".intro")).toContain("proves its fix by actually running it");
  }, 30_000);

  it("explains the replay and the non-isolated sandbox in a popover", async () => {
    await page.getByRole("button", { name: /Local sandbox/ }).click();
    const popover = page.locator("#pop-sandbox");
    await popover.waitFor({ state: "visible" });
    expect(await popover.textContent()).toMatch(/without network or filesystem isolation/);
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: /Recorded drafts/ }).click();
    expect(await page.locator("#pop-model").textContent()).toMatch(/Everything after drafting genuinely runs/);
    await page.keyboard.press("Escape");
  }, 30_000);

  it("remembers that the intro was dismissed", async () => {
    await page.getByRole("button", { name: "Got it" }).click();
    expect(await page.locator(".intro").count()).toBe(0);

    await page.reload();
    await page.waitForSelector(".incident");
    expect(await page.locator(".intro").count()).toBe(0);
  }, 30_000);

  it("runs the flagship incident live: a failed first draft, a repair, and a verified verdict", async () => {
    await page.getByRole("button", { name: /Run this incident/ }).click();
    await page.waitForSelector(".verdict", { timeout: 60_000 });

    expect(await page.textContent(".verdict-headline")).toBe("Verified after 1 repair");
    expect(await page.locator(".stage-done").count()).toBe(5);

    const tabs = await page.locator('[role="tab"]').allInnerTexts();
    expect(tabs.map((tab) => tab.replace(/\s+/g, " ").trim())).toEqual(["Changes", "Attempt 1 (Failed)", "Attempt 2 (Passed)"]);

    // The default view is the change between drafts, with the exact edit marked.
    expect(await page.locator(".line-del").count()).toBeGreaterThan(0);
    expect(await page.locator(".line-add").count()).toBeGreaterThan(0);
    expect(await page.locator(".line-add mark").count()).toBeGreaterThan(0);
    expect(await page.locator(".console").first().textContent()).toContain("AssertionError");
    expect(await page.locator(".console").nth(1).textContent()).toContain("VERIFIED");
  }, 90_000);

  it("lets you inspect each attempt on its own", async () => {
    await page.getByRole("tab", { name: /Attempt 1/ }).click();
    expect(await page.textContent(".code-panel")).toContain("Failed");
    expect(await page.locator(".line-del").count()).toBe(0);
    expect(await page.locator(".code .line").count()).toBeGreaterThan(20);

    await page.getByRole("tab", { name: /Attempt 2/ }).click();
    expect(await page.textContent(".code-panel")).toContain("Passed");
    expect(await page.textContent(".code-panel")).toContain("_escape_label_value");
  }, 30_000);

  it("supports keyboard navigation between tabs", async () => {
    await page.getByRole("tab", { name: /Changes/ }).focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.getByRole("tab", { name: /Attempt 1/ }).getAttribute("aria-selected")).toBe("true");
  }, 30_000);

  it("records the run in the history and the session stats", async () => {
    expect(await page.locator(".run-item").count()).toBeGreaterThanOrEqual(1);
    expect(await page.textContent(".stats-line")).toMatch(/1 repaired by the agent/);
  }, 30_000);

  it("shows a blocked incident as a first-class outcome: no model call, no code", async () => {
    await page.getByRole("button", { name: /Attack: alert text tries to unlock/ }).click();
    await page.getByRole("button", { name: /Run this incident/ }).click();
    await page.waitForSelector(".verdict-blocked", { timeout: 30_000 });

    expect(await page.textContent(".verdict-headline")).toBe("Blocked by the policy gate");
    expect(await page.textContent(".verdict")).toMatch(/no AI model was called/i);
    expect(await page.locator(".results").count()).toBe(0);
    expect(await page.textContent(".policy-note")).toContain("Decided from the file path only");
    expect(await page.textContent(".terminal")).toMatch(/Ignore all previous instructions/i);
  }, 60_000);

  it("follows the URL hash: back/forward and pasted deep links change the incident", async () => {
    await page.evaluate(() => (location.hash = "#token-bucket"));
    await expect.poll(() => page.textContent("h1")).toMatch(/Rate limiter missing/);
    await page.goBack();
    await expect.poll(() => page.textContent("h1")).toMatch(/Attack: alert text/);
  }, 30_000);

  it("runs on the 'r' shortcut, but never while typing in a field", async () => {
    await page.evaluate(() => (location.hash = "#retry-backoff"));
    await expect.poll(() => page.textContent("h1")).toMatch(/Retry helper missing/);
    await page.locator(".sidebar").focus();
    await page.keyboard.press("r");
    await page.waitForSelector(".verdict-verified", { timeout: 60_000 });
    expect(await page.textContent(".verdict-headline")).toBe("Verified on the first try");
    expect(await page.locator('[role="tab"]').count()).toBe(1);
  }, 90_000);

  it("switches theme", async () => {
    const before = await page.getAttribute("html", "data-theme");
    await page.getByRole("button", { name: /^Theme:/ }).click();
    await expect.poll(() => page.getAttribute("html", "data-theme")).not.toBe(before === "dark" ? "light" : "dark");
  }, 30_000);

  it("fits a phone: no horizontal overflow, and the pipeline is readable", async () => {
    await freshPage({ width: 390, height: 844 });
    await page.goto(`${base}/#telemetry-exporter`);
    await page.waitForSelector(".incident");
    await page.getByRole("button", { name: "Got it" }).click();
    await page.getByRole("button", { name: /Run this incident/ }).click();
    await page.waitForSelector(".verdict", { timeout: 60_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The stepper is vertical on a phone, so each stage sits below the last.
    const boxes = await page.locator(".stage").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect([...boxes].sort((a, b) => a - b)).toEqual(boxes);
    expect(new Set(boxes).size).toBe(boxes.length);
  }, 90_000);

  it("produced no console errors or warnings across the whole session", () => {
    expect(problems).toEqual([]);
  });
});

/** The drafted code, error text and lint messages all come from an untrusted
 * model. If any of it were ever inserted as markup, one hostile draft could
 * run script in the visitor's browser. */
describe.skipIf(!chromiumPath)("dashboard renders untrusted model output as inert text", () => {
  const HOSTILE = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>`;

  const hostilePlan: RemediationPlan = {
    incident_id: "INC-HOSTILE",
    service_name: "svc",
    target_file_path: "/app/x.py",
    root_cause_analysis: { error_type: HOSTILE, failing_component: HOSTILE, detailed_explanation: HOSTILE },
    policy_check: { is_safe_to_remediate: true, risk_level: "LOW", risk_reasoning: HOSTILE },
    remediation: { action: "CREATE_FILE", module_summary: HOSTILE, full_file_content: `print("${HOSTILE}")\n` },
    sandbox_verification: {
      container_image: "python:3.11-slim",
      resource_limits: { cpu_limit: "0.5", memory_limit: "256m" },
      test_commands: [HOSTILE],
      expected_output_pattern: "x",
    },
    verdict: "FAILED_VERIFICATION",
    verification_note: HOSTILE,
    attempts: [
      {
        attempt: 1,
        kind: "initial",
        module_summary: HOSTILE,
        full_file_content: `print("${HOSTILE}")\n`,
        container_image: "python:3.11-slim",
        test_commands: [HOSTILE],
        expected_output_pattern: "x",
        lint_issues: [HOSTILE],
        sandbox_run_result: null,
        passed: false,
      },
    ],
  };

  const hostileEngine = {
    remediate: async (_incident: unknown, options: RemediateOptions = {}) => {
      options.onEvent?.({ type: "policy_checked", policy: hostilePlan.policy_check });
      options.onEvent?.({ type: "draft_started", attempt: 1, kind: "initial" });
      options.onEvent?.({ type: "draft_ready", attempt: 1, kind: "initial", moduleSummary: HOSTILE, fileContent: `print("${HOSTILE}")\n`, containerImage: "python:3.11-slim", testCommands: [HOSTILE] });
      options.onEvent?.({ type: "lint_finished", attempt: 1, issues: [HOSTILE] });
      options.onEvent?.({ type: "run_finished", plan: hostilePlan });
      return hostilePlan;
    },
  } as unknown as RemediationEngine;

  it("never executes or parses hostile strings from the model", async () => {
    const { server, base } = await serve(hostileEngine);
    const browser = await launch(chromiumPath as string);
    try {
      const page = await (await browser.newContext()).newPage();
      const dialogs: string[] = [];
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });

      await page.goto(base);
      await page.waitForSelector(".incident");
      await page.getByRole("button", { name: "Got it" }).click();
      await page.getByRole("button", { name: /Run this incident/ }).click();
      await page.waitForSelector(".verdict", { timeout: 30_000 });
      await page.getByRole("tab", { name: /Attempt 1/ }).click();
      await page.waitForTimeout(300);

      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(await page.locator("main img, main script").count()).toBe(0);
      // It is shown literally, so the operator can still read what the model wrote.
      expect(await page.textContent("main")).toContain("<img src=x");
    } finally {
      await browser.close();
      await close(server);
    }
  }, 60_000);
});
