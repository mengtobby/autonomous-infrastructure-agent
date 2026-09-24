import type { DemoScenario } from "../types.js";
import { deployComposeScenario } from "./deployCompose.js";
import { promptInjectionScenario, systemPathScenario } from "./blockedScenarios.js";
import { retryBackoffScenario } from "./retryBackoff.js";
import { telemetryExporterScenario } from "./telemetryExporter.js";
import { tokenBucketScenario } from "./tokenBucket.js";

/** Ordered for a demo: the self-repair story first, then quick wins, then
 * the safety story. */
export const demoScenarios: readonly DemoScenario[] = [
  telemetryExporterScenario,
  retryBackoffScenario,
  tokenBucketScenario,
  deployComposeScenario,
  promptInjectionScenario,
  systemPathScenario,
];

export function findScenario(id: string): DemoScenario | undefined {
  return demoScenarios.find((scenario) => scenario.id === id);
}
