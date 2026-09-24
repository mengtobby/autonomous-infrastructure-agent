import type { DemoScenario } from "../types.js";

/** Avoids template literals on purpose: the recorded source is embedded in a
 * JS string here, and backticks would need escaping. */
const RETRY_SOURCE = String.raw`"use strict";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an async operation and retries failures with exponential backoff and
 * full jitter, so a fleet of clients does not retry in lockstep.
 *
 * @param {(attempt: number) => Promise<any>} operation
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number,
 *          shouldRetry?: (error: unknown, attempt: number) => boolean}} [options]
 * @returns {Promise<any>} the first successful result
 * @throws the last error once retries are exhausted or shouldRetry says stop
 */
async function retryWithBackoff(operation, options = {}) {
  const { retries = 3, baseDelayMs = 100, maxDelayMs = 5000, shouldRetry = () => true } = options;

  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function");
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("retries must be a non-negative integer");
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error, attempt)) {
        break;
      }
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(Math.random() * ceiling);
    }
  }
  throw lastError;
}

module.exports = { retryWithBackoff };
`;

const TEST_COMMAND =
  "node -e \"const { retryWithBackoff } = require('./src/utils/retry.js'); let n = 0; " +
  "retryWithBackoff(async () => { n += 1; if (n < 3) throw new Error('flaky'); return 'ok'; }, { retries: 5, baseDelayMs: 1 })" +
  ".then((r) => { if (r !== 'ok' || n !== 3) throw new Error('unexpected result ' + r + ' after ' + n + ' calls'); " +
  "console.log('VERIFIED'); })\"";

export const retryBackoffScenario: DemoScenario = {
  id: "retry-backoff",
  title: "Retry helper missing — checkout API returns 500s",
  blurb: "A Node.js utility drafted and proven correct on the first pass: two simulated failures, then success.",
  tags: ["Node.js", "LOW risk", "first-try"],
  expectedVerdict: "VERIFIED",
  incident: {
    incident_id: "INC-20260924-API-07",
    service_name: "checkout-api",
    timestamp: "2026-09-24T14:11:52Z",
    target_file_path: "/app/src/utils/retry.js",
    error_log: [
      "Error: Cannot find module './utils/retry'",
      "Require stack:",
      "- /app/src/services/paymentClient.js",
      "- /app/src/routes/checkout.js",
      "    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:1077:15)",
      "checkout-api: uncaught exception, 500 returned for POST /checkout",
    ].join("\n"),
    service_requirements_context:
      "Export retryWithBackoff(operation, { retries, baseDelayMs }) from a CommonJS module. It must retry a failing " +
      "async operation with exponential backoff and jitter, return the first success, and rethrow the last error once " +
      "retries are exhausted.",
  },
  recordedDrafts: [
    {
      root_cause_analysis: {
        error_type: "MODULE_NOT_FOUND",
        failing_component: "/app/src/utils/retry.js",
        detailed_explanation:
          "paymentClient.js requires ./utils/retry, which is absent from the deployed image, so every checkout request " +
          "throws during module load and the API answers 500.",
      },
      module_summary: "Exponential-backoff retry helper with full jitter and a shouldRetry hook.",
      full_file_content: RETRY_SOURCE,
      container_image: "node:20-slim",
      test_commands: [TEST_COMMAND],
      expected_output_pattern: "VERIFIED",
    },
  ],
};
