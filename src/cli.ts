#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { createRuntime } from "./app/createRuntime.js";
import { loadConfig } from "./config/env.js";
import { demoScenarios, findScenario } from "./demo/scenarios/index.js";
import { EXIT_CODES, exitCodeFor, mayWrite } from "./cli/outcome.js";
import { formatProgress } from "./cli/progress.js";
import { resolveWriteTarget } from "./cli/resolveWriteTarget.js";
import { logger } from "./logging/logger.js";
import { incidentAlertSchema, type IncidentAlert } from "./schemas/incident.schema.js";
import type { RemediationPlan } from "./schemas/remediation.schema.js";

interface AnalyzeOptions {
  verify: boolean;
  write: boolean;
  out?: string;
  scenario?: string;
  repairAttempts?: number;
  quiet: boolean;
}

const program = new Command();

program
  .name("infra-agent")
  .description("Autonomous SRE remediation agent: drafts a fix, proves it in a sandbox, repairs it if it fails")
  .version("0.2.0");

program
  .command("analyze")
  .description("Analyze an incident alert and produce a remediation plan")
  .argument("[incidentFile]", "path to a JSON file matching the incident alert schema")
  .option("-s, --scenario <id>", "run a built-in demo scenario instead of a file (see `infra-agent scenarios`)")
  .option("--verify", "execute the drafted fix in the sandbox, and repair it if it fails", false)
  .option("--repair-attempts <n>", "how many times a failed draft may be repaired", parseRepairAttempts)
  .option("--write", "write the verified file to its target_file_path (inside the current directory)", false)
  .option("--out <file>", "write the remediation plan JSON to a file instead of stdout")
  .option("-q, --quiet", "suppress the live progress view on stderr", false)
  .action(async (incidentFile: string | undefined, options: AnalyzeOptions) => {
    try {
      const { plan, verifyRequested } = await runAnalyze(incidentFile, options);
      const json = JSON.stringify(plan, null, 2);

      if (options.out) {
        await writeFile(options.out, json, "utf8");
        logger.info({ out: options.out }, "Remediation plan written to file");
      } else {
        process.stdout.write(json + "\n");
      }

      process.exitCode = exitCodeFor(plan, verifyRequested);
    } catch (error) {
      logger.error({ err: error }, "Failed to analyze incident");
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_CODES.ERROR;
    }
  });

program
  .command("scenarios")
  .description("List the built-in demo scenarios")
  .action(() => {
    for (const scenario of demoScenarios) {
      process.stdout.write(`${scenario.id.padEnd(20)} ${scenario.title}\n${" ".repeat(21)}${scenario.tags.join(" · ")}\n`);
    }
  });

function parseRepairAttempts(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new InvalidArgumentError("must be a whole number from 0 to 5");
  }
  return parsed;
}

async function loadIncident(incidentFile: string | undefined, scenarioId: string | undefined): Promise<IncidentAlert> {
  if (scenarioId) {
    const scenario = findScenario(scenarioId);
    if (!scenario) {
      throw new Error(`Unknown scenario '${scenarioId}'. Available: ${demoScenarios.map((s) => s.id).join(", ")}`);
    }
    return scenario.incident;
  }

  if (!incidentFile) {
    throw new Error("Provide an incident JSON file, or --scenario <id> to run a built-in demo scenario.");
  }

  return incidentAlertSchema.parse(JSON.parse(await readFile(incidentFile, "utf8")));
}

async function runAnalyze(
  incidentFile: string | undefined,
  options: AnalyzeOptions
): Promise<{ plan: RemediationPlan; verifyRequested: boolean }> {
  const config = loadConfig();
  const incident = await loadIncident(incidentFile, options.scenario);
  const runtime = await createRuntime(config, { verify: options.verify, maxRepairAttempts: options.repairAttempts });

  if (!options.quiet) {
    process.stderr.write(`incident ${incident.incident_id} · ${incident.service_name} · ${incident.target_file_path}\n`);
    if (options.verify) {
      process.stderr.write(`sandbox: ${runtime.info.sandbox.note}\n`);
    }
  }

  const plan = await runtime.engine.remediate(incident, {
    onEvent: (event) => {
      if (!options.quiet) {
        process.stderr.write(formatProgress(event) + "\n");
      }
    },
  });

  if (options.write) {
    await writeIfAllowed(plan, options.verify);
  }

  return { plan, verifyRequested: options.verify };
}

async function writeIfAllowed(plan: RemediationPlan, verifyRequested: boolean): Promise<void> {
  if (!mayWrite(plan, verifyRequested)) {
    logger.warn({ verdict: plan.verdict }, "Not writing the remediation file: it is not verified");
    process.stderr.write(`not writing ${plan.target_file_path}: verdict is ${plan.verdict ?? "unknown"}\n`);
    return;
  }

  const { path: targetPath, withinProjectRoot } = resolveWriteTarget(process.cwd(), plan.target_file_path);
  if (!withinProjectRoot) {
    logger.warn(
      { targetFilePath: plan.target_file_path, resolvedPath: targetPath },
      "Refusing to write remediation file outside the current working directory"
    );
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, plan.remediation.full_file_content, "utf8");
  logger.info({ targetPath }, "Remediation file written to disk");
  process.stderr.write(`wrote ${targetPath}\n`);
}

program.parseAsync(process.argv).catch((error) => {
  logger.error({ err: error }, "Unhandled CLI error");
  process.exitCode = EXIT_CODES.ERROR;
});
