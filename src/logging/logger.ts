import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

/**
 * Structured logger writing to stderr so stdout stays reserved for
 * machine-parseable command output (e.g. the CLI's JSON remediation plan).
 */
export const logger = pino(
  {
    level,
    base: { service: "autonomous-infra-agent" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(2)
);
