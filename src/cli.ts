#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config/env.js";
import { incidentAlertSchema } from "./schemas/incident.schema.js";
import { RemediationEngine } from "./core/remediationEngine.js";
import { OllamaLlmClient } from "./llm/ollamaClient.js";
import { DockerSandboxRunner } from "./sandbox/dockerSandboxRunner.js";
import { ProcessCommandRunner } from "./sandbox/processCommandRunner.js";
import { logger } from "./logging/logger.js";
import type { RemediationPlan } from "./schemas/remediation.schema.js";

const program = new Command();

program
  .name("infra-agent")
  .description("Autonomous SRE remediation agent for microservice incident alerts")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze an incident alert and produce a remediation plan")
  .argument("<incidentFile>", "path to a JSON file matching the incident alert schema")
  .option("--verify", "run the drafted remediation through Docker sandbox verification", false)
  .option("--write", "write the remediation file to its target_file_path if policy allows it", false)
  .option("--out <file>", "write the remediation plan JSON to a file instead of stdout")
  .action(async (incidentFile: string, options: { verify: boolean; write: boolean; out?: string }) => {
    try {
      const plan = await runAnalyze(incidentFile, options);
      const json = JSON.stringify(plan, null, 2);

      if (options.out) {
        await writeFile(options.out, json, "utf8");
        logger.info({ out: options.out }, "Remediation plan written to file");
      } else {
        process.stdout.write(json + "\n");
      }

      process.exitCode = plan.policy_check.is_safe_to_remediate ? 0 : 2;
    } catch (error) {
      logger.error({ err: error }, "Failed to analyze incident");
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

async function runAnalyze(
  incidentFile: string,
  options: { verify: boolean; write: boolean }
): Promise<RemediationPlan> {
  const config = loadConfig();
  const raw = await readFile(incidentFile, "utf8");
  const incident = incidentAlertSchema.parse(JSON.parse(raw));

  const engine = new RemediationEngine({
    llmClient: new OllamaLlmClient({
      baseUrl: config.OLLAMA_BASE_URL,
      model: config.OLLAMA_MODEL,
      numCtx: config.OLLAMA_NUM_CTX,
    }),
    defaultResourceLimits: {
      cpu_limit: config.SANDBOX_CPU_LIMIT,
      memory_limit: config.SANDBOX_MEMORY_LIMIT,
    },
  });

  let plan = await engine.remediate(incident);

  if (options.verify && plan.remediation.action === "CREATE_FILE") {
    const sandboxRunner = new DockerSandboxRunner({
      commandRunner: new ProcessCommandRunner(),
      timeoutSeconds: config.SANDBOX_TIMEOUT_SECONDS,
    });
    const sandboxRunResult = await sandboxRunner.run(plan);
    plan = { ...plan, sandbox_run_result: sandboxRunResult };
  }

  if (options.write && plan.policy_check.is_safe_to_remediate && plan.remediation.action === "CREATE_FILE") {
    const targetPath = resolve(plan.target_file_path.replace(/^\/+/, ""));
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, plan.remediation.full_file_content, "utf8");
    logger.info({ targetPath }, "Remediation file written to disk");
  }

  return plan;
}

program.parseAsync(process.argv).catch((error) => {
  logger.error({ err: error }, "Unhandled CLI error");
  process.exitCode = 1;
});
