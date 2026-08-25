import { incidentAlertSchema } from "../src/schemas/incident.schema.js";
import { checkPolicy } from "../src/core/policyChecker.js";
import { RemediationEngine } from "../src/core/remediationEngine.js";
import { OllamaLlmClient } from "../src/llm/ollamaClient.js";
import { DockerSandboxRunner } from "../src/sandbox/dockerSandboxRunner.js";
import { ProcessCommandRunner } from "../src/sandbox/processCommandRunner.js";
import { loadConfig } from "../src/config/env.js";
import { allFixtures } from "./fixtures/index.js";
import type { EvalCheck, EvalFixture, EvalResult } from "./types.js";
import type { RemediationPlan } from "../src/schemas/remediation.schema.js";

const args = new Set(process.argv.slice(2));
const runGeneration = args.has("--generate") || args.has("--full");
const runVerify = args.has("--verify") || args.has("--full");

async function evaluateFixture(fixture: EvalFixture, engine: RemediationEngine | null, sandbox: DockerSandboxRunner | null): Promise<EvalResult> {
  const checks: EvalCheck[] = [];
  const parsed = incidentAlertSchema.safeParse(fixture.incidentRaw);

  checks.push({
    label: "schema validation",
    passed: parsed.success === fixture.expect.schemaValid,
    detail: parsed.success
      ? fixture.expect.schemaValid
        ? undefined
        : "expected schema to reject this input, but it was accepted"
      : fixture.expect.schemaValid
        ? `expected valid input, but schema rejected it: ${parsed.error.issues.map((i) => i.message).join("; ")}`
        : undefined,
  });

  if (!parsed.success || !fixture.expect.schemaValid) {
    return { fixture, skipped: false, checks };
  }

  const incident = parsed.data;
  const policyCheck = checkPolicy({
    targetFilePath: incident.target_file_path,
    errorLog: incident.error_log,
    serviceRequirementsContext: incident.service_requirements_context,
  });

  if (fixture.expect.isSafeToRemediate !== undefined) {
    checks.push({
      label: "is_safe_to_remediate",
      passed: policyCheck.is_safe_to_remediate === fixture.expect.isSafeToRemediate,
      detail: `expected ${fixture.expect.isSafeToRemediate}, got ${policyCheck.is_safe_to_remediate} (${policyCheck.risk_reasoning})`,
    });
  }

  if (fixture.expect.riskLevel !== undefined) {
    checks.push({
      label: "risk_level",
      passed: policyCheck.risk_level === fixture.expect.riskLevel,
      detail: `expected ${fixture.expect.riskLevel}, got ${policyCheck.risk_level}`,
    });
  }

  if (fixture.category !== "generation") {
    return { fixture, skipped: false, checks };
  }

  if (!engine) {
    return { fixture, skipped: true, checks };
  }

  let plan: RemediationPlan;
  try {
    plan = await engine.remediate(incident);
  } catch (error) {
    checks.push({
      label: "remediation.remediate() completed",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { fixture, skipped: false, checks };
  }

  if (fixture.expect.action !== undefined) {
    checks.push({
      label: "remediation.action",
      passed: plan.remediation.action === fixture.expect.action,
      detail: `expected ${fixture.expect.action}, got ${plan.remediation.action}`,
    });
  }

  if (fixture.expect.content) {
    checks.push(...evaluateContent(plan, fixture.expect.content));
  }

  if (runVerify && sandbox && plan.remediation.action === "CREATE_FILE") {
    const sandboxResult = await sandbox.run(plan);
    checks.push({
      label: "sandbox verification (informational)",
      passed: sandboxResult.passed,
      detail: sandboxResult.passed
        ? undefined
        : `exit_code=${String(sandboxResult.exit_code)} timed_out=${sandboxResult.timed_out} stdout/stderr=${(sandboxResult.stdout + sandboxResult.stderr).slice(0, 300)}`,
    });
  }

  return { fixture, skipped: false, checks };
}

function evaluateContent(plan: RemediationPlan, content: NonNullable<EvalFixture["expect"]["content"]>): EvalCheck[] {
  const text = plan.remediation.full_file_content;
  const checks: EvalCheck[] = [];

  checks.push({
    label: "content length",
    passed: text.trim().length >= content.minLength,
    detail: `expected >= ${content.minLength} chars, got ${text.trim().length}`,
  });

  for (const needle of content.mustContain) {
    checks.push({
      label: `content contains "${needle}"`,
      passed: text.toLowerCase().includes(needle.toLowerCase()),
    });
  }

  if (content.mustContainAnyOf && content.mustContainAnyOf.length > 0) {
    const lowerText = text.toLowerCase();
    checks.push({
      label: `content contains any of [${content.mustContainAnyOf.join(", ")}]`,
      passed: content.mustContainAnyOf.some((needle) => lowerText.includes(needle.toLowerCase())),
    });
  }

  for (const pattern of content.mustNotMatch) {
    checks.push({
      label: `content does not match ${pattern}`,
      passed: !pattern.test(text),
      detail: pattern.test(text) ? "content looks like JSON-wrapped pseudo-code rather than real source" : undefined,
    });
  }

  return checks;
}

async function main(): Promise<void> {
  const config = loadConfig();

  const engine = runGeneration
    ? new RemediationEngine({
        llmClient: new OllamaLlmClient({
          baseUrl: config.OLLAMA_BASE_URL,
          model: config.OLLAMA_MODEL,
          numCtx: config.OLLAMA_NUM_CTX,
          requestTimeoutMs: config.OLLAMA_REQUEST_TIMEOUT_SECONDS * 1000,
        }),
        defaultResourceLimits: { cpu_limit: config.SANDBOX_CPU_LIMIT, memory_limit: config.SANDBOX_MEMORY_LIMIT },
      })
    : null;

  const sandbox = runVerify
    ? new DockerSandboxRunner({ commandRunner: new ProcessCommandRunner(), timeoutSeconds: config.SANDBOX_TIMEOUT_SECONDS })
    : null;

  if (runGeneration) {
    process.stdout.write(`Generation fixtures enabled — calling ${config.OLLAMA_MODEL} at ${config.OLLAMA_BASE_URL}. This takes a while.\n\n`);
  }

  const results: EvalResult[] = [];
  for (const fixture of allFixtures) {
    const shouldRunGeneration = fixture.category !== "generation" || runGeneration;
    const result = shouldRunGeneration
      ? await evaluateFixture(fixture, engine, sandbox)
      : { fixture, skipped: true, checks: [] as EvalCheck[] };
    results.push(result);
    printResult(result);
  }

  printSummary(results);

  const hasFailure = results.some((r) => !r.skipped && r.checks.some((c) => !c.passed && !c.label.includes("(informational)")));
  process.exitCode = hasFailure ? 1 : 0;
}

function printResult(result: EvalResult): void {
  if (result.skipped) {
    process.stdout.write(`SKIP  ${result.fixture.id}  (generation fixture; pass --generate to run it)\n`);
    return;
  }

  const failed = result.checks.filter((c) => !c.passed);
  const status = failed.length === 0 ? "PASS" : "FAIL";
  process.stdout.write(`${status}  ${result.fixture.id}  [${result.fixture.category}]  ${result.fixture.description}\n`);
  for (const check of failed) {
    process.stdout.write(`      ✗ ${check.label}${check.detail ? ` — ${check.detail}` : ""}\n`);
  }
}

function printSummary(results: EvalResult[]): void {
  const byCategory = new Map<string, { pass: number; fail: number; skip: number }>();
  for (const result of results) {
    const bucket = byCategory.get(result.fixture.category) ?? { pass: 0, fail: 0, skip: 0 };
    if (result.skipped) {
      bucket.skip += 1;
    } else if (result.checks.every((c) => c.passed)) {
      bucket.pass += 1;
    } else {
      bucket.fail += 1;
    }
    byCategory.set(result.fixture.category, bucket);
  }

  process.stdout.write("\n--- summary ---\n");
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  for (const [category, bucket] of byCategory) {
    process.stdout.write(`${category.padEnd(12)} pass=${bucket.pass} fail=${bucket.fail} skip=${bucket.skip}\n`);
    totalPass += bucket.pass;
    totalFail += bucket.fail;
    totalSkip += bucket.skip;
  }
  process.stdout.write(`${"total".padEnd(12)} pass=${totalPass} fail=${totalFail} skip=${totalSkip}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`eval runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
