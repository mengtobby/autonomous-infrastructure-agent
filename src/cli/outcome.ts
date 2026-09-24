import type { RemediationPlan } from "../schemas/remediation.schema.js";

/** Process exit codes, so scripts and CI can react to what happened. */
export const EXIT_CODES = {
  /** Verified — or unverified because the user never asked for verification. */
  OK: 0,
  ERROR: 1,
  BLOCKED: 2,
  FAILED_VERIFICATION: 3,
  /** Verification was requested but could not run (e.g. Docker unavailable). */
  COULD_NOT_VERIFY: 4,
} as const;

export function exitCodeFor(plan: RemediationPlan, verifyRequested: boolean): number {
  switch (plan.verdict) {
    case "BLOCKED":
      return EXIT_CODES.BLOCKED;
    case "FAILED_VERIFICATION":
      return EXIT_CODES.FAILED_VERIFICATION;
    case "UNVERIFIED":
      return verifyRequested ? EXIT_CODES.COULD_NOT_VERIFY : EXIT_CODES.OK;
    default:
      return plan.policy_check.is_safe_to_remediate ? EXIT_CODES.OK : EXIT_CODES.BLOCKED;
  }
}

/**
 * Whether --write may put the drafted file on disk. A draft that failed its
 * own tests, or was blocked by policy, is never written. An unverified draft
 * is only written when the user chose not to verify; if they asked for
 * verification and it couldn't run, nothing is written on a hunch.
 */
export function mayWrite(plan: RemediationPlan, verifyRequested: boolean): boolean {
  if (plan.remediation.action !== "CREATE_FILE" || !plan.policy_check.is_safe_to_remediate) {
    return false;
  }
  return plan.verdict === "VERIFIED" || (plan.verdict === "UNVERIFIED" && !verifyRequested);
}
