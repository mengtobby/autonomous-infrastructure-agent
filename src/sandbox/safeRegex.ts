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

/** True only for a pattern that cannot backtrack at all: no repetition
 * (`* + ? {`), no groups, no alternation, no escapes. Such a pattern matches
 * in time linear in the text regardless of its length or content — exactly
 * what almost every model-written success marker (`VERIFIED`, `OK`, …) is —
 * so it is safe to run directly rather than through a worker. This matters
 * in practice: spawning a worker thread can itself take longer than a short
 * timeoutMs when the machine is busy, which would otherwise report a
 * perfectly harmless pattern as abandoned. */
const CANNOT_BACKTRACK = /^[^*+?{(|\\]*$/;

/**
 * Tests `text` against a model-supplied pattern without letting it stall the
 * server. A pattern like ^(a+)+$ takes exponential time on some inputs, and
 * regex matching cannot be interrupted on the main thread, so one hostile or
 * careless draft would freeze every run, stream and health check at once.
 * Here the match runs in a worker that is terminated after `timeoutMs` — for
 * any pattern that could actually behave that way; a provably linear one
 * (see CANNOT_BACKTRACK) is matched directly, with no worker and no race
 * against the timeout.
 */
export function safeRegexTest(pattern: string, text: string, timeoutMs = 250): Promise<RegexOutcome> {
  if (CANNOT_BACKTRACK.test(pattern)) {
    try {
      return Promise.resolve(new RegExp(pattern).test(text) ? "match" : "no-match");
    } catch {
      return Promise.resolve("invalid");
    }
  }

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
