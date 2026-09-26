import { Worker } from "node:worker_threads";

export type RegexOutcome = "match" | "no-match" | "invalid" | "timeout";

/** Runs in a worker so a catastrophic pattern can be killed. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
let outcome;
try {
  outcome = new RegExp(workerData.pattern).test(workerData.text) ? "match" : "no-match";
} catch {
  outcome = "invalid";
}
parentPort.postMessage(outcome);
`;

/**
 * Tests `text` against a model-supplied pattern without letting it stall the
 * server. A pattern like ^(a+)+$ takes exponential time on some inputs, and
 * regex matching cannot be interrupted on the main thread, so one hostile or
 * careless draft would freeze every run, stream and health check at once.
 * Here the match runs in a worker that is terminated after `timeoutMs`.
 */
export function safeRegexTest(pattern: string, text: string, timeoutMs = 250): Promise<RegexOutcome> {
  return new Promise<RegexOutcome>((resolve) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { pattern, text } });
    let settled = false;

    const finish = (outcome: RegexOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    worker.once("message", (outcome: RegexOutcome) => finish(outcome));
    worker.once("error", () => finish("invalid"));
  });
}
