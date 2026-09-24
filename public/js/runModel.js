// Pure state for one run, derived only from the server's pipeline events.
// The same reducer drives a live stream and the replay of a finished run, so
// a run looks identical whether you watched it or opened it from history.

/** @typedef {'pending'|'active'|'done'|'failed'|'blocked'|'skipped'} StageState */

export function initialModel() {
  return {
    policy: null,
    attempts: [],
    plan: null,
    verdict: null,
    error: null,
    started: false,
    done: false,
  };
}

const emptyAttempt = (n, kind) => ({
  n,
  kind,
  drafting: true,
  summary: "",
  content: "",
  image: "",
  commands: [],
  lintIssues: null,
  sandboxState: "idle", // idle | running | done
  sandboxMode: null,
  sandbox: null,
  passed: null,
});

const replaceAttempt = (attempts, n, changes) =>
  attempts.map((attempt) => (attempt.n === n ? { ...attempt, ...changes } : attempt));

/** @param {ReturnType<typeof initialModel>} model  @param {{event: object}} timed */
export function applyEvent(model, timed) {
  const event = timed.event;
  switch (event.type) {
    case "policy_checked":
      return { ...model, started: true, policy: event.policy };

    case "draft_started":
      return {
        ...model,
        started: true,
        attempts: model.attempts.some((a) => a.n === event.attempt)
          ? model.attempts
          : [...model.attempts, emptyAttempt(event.attempt, event.kind)],
      };

    case "draft_ready":
      return {
        ...model,
        attempts: (model.attempts.some((a) => a.n === event.attempt)
          ? model.attempts
          : [...model.attempts, emptyAttempt(event.attempt, event.kind)]
        ).map((attempt) =>
          attempt.n === event.attempt
            ? {
                ...attempt,
                drafting: false,
                summary: event.moduleSummary,
                content: event.fileContent,
                image: event.containerImage,
                commands: event.testCommands,
              }
            : attempt
        ),
      };

    case "lint_finished":
      return { ...model, attempts: replaceAttempt(model.attempts, event.attempt, { lintIssues: event.issues }) };

    case "sandbox_started":
      return { ...model, attempts: replaceAttempt(model.attempts, event.attempt, { sandboxState: "running", sandboxMode: event.mode }) };

    case "sandbox_finished":
      return {
        ...model,
        attempts: replaceAttempt(model.attempts, event.attempt, {
          sandboxState: "done",
          sandbox: event.result,
          passed: event.result.passed,
        }),
      };

    case "run_finished":
      return finishFromPlan(model, event.plan);

    case "run_failed":
      return { ...model, done: true, error: event.message };

    default:
      return model;
  }
}

/** The plan is authoritative: it settles each attempt's pass/fail, including
 * attempts rejected by static checks that never reached the sandbox. */
function finishFromPlan(model, plan) {
  const planAttempts = plan.attempts ?? [];
  const attempts = model.attempts.map((attempt) => {
    const settled = planAttempts.find((candidate) => candidate.attempt === attempt.n);
    return settled ? { ...attempt, passed: settled.passed, lintIssues: settled.lint_issues } : attempt;
  });
  return { ...model, plan, attempts, verdict: plan.verdict ?? null, done: true };
}

/** Rebuild a model from a stored run record's events. */
export function modelFromEvents(events) {
  return events.reduce(applyEvent, initialModel());
}

export const latestAttempt = (model) => model.attempts[model.attempts.length - 1] ?? null;

/** Number of repair rounds the agent used (attempts after the first). */
export const repairCount = (model) => Math.max(0, model.attempts.length - 1);

/**
 * The five pipeline stages and where each stands, for the stepper.
 * @returns {{policy: Stage, draft: Stage, checks: Stage, sandbox: Stage, verdict: Stage}}
 */
export function stageStates(model) {
  const last = latestAttempt(model);
  const blocked = model.verdict === "BLOCKED" || (model.policy && !model.policy.is_safe_to_remediate);

  if (!model.started) {
    return allPending();
  }

  const policy = model.policy
    ? { state: blocked ? "blocked" : "done", detail: `${model.policy.risk_level} risk` }
    : { state: "active", detail: "checking" };

  if (blocked) {
    return {
      policy,
      draft: { state: "skipped", detail: "no model call" },
      checks: { state: "skipped", detail: "" },
      sandbox: { state: "skipped", detail: "" },
      verdict: { state: "blocked", detail: "BLOCKED" },
    };
  }

  const draft = !last
    ? { state: model.policy ? "active" : "pending", detail: model.policy ? "asking the model" : "" }
    : last.drafting
      ? { state: "active", detail: last.kind === "repair" ? `repair ${last.n - 1}` : "asking the model" }
      : { state: "done", detail: last.n > 1 ? `attempt ${last.n}` : "drafted" };

  const checks = stageFromChecks(last);
  const sandbox = stageFromSandbox(last);
  const verdict = stageFromVerdict(model);

  return { policy, draft, checks, sandbox, verdict };
}

function allPending() {
  const pending = { state: "pending", detail: "" };
  return { policy: pending, draft: pending, checks: pending, sandbox: pending, verdict: pending };
}

function stageFromChecks(last) {
  if (!last || last.drafting) {
    return { state: "pending", detail: "" };
  }
  if (last.lintIssues === null) {
    return { state: "active", detail: "checking" };
  }
  return last.lintIssues.length === 0
    ? { state: "done", detail: "clean" }
    : { state: "failed", detail: `${last.lintIssues.length} problem${last.lintIssues.length === 1 ? "" : "s"}` };
}

function stageFromSandbox(last) {
  if (!last || last.lintIssues === null) {
    return { state: "pending", detail: "" };
  }
  if (last.lintIssues.length > 0) {
    return { state: "skipped", detail: "not run" };
  }
  if (last.sandboxState === "running") {
    return { state: "active", detail: "running tests" };
  }
  if (last.sandboxState === "done" && last.sandbox) {
    if (last.sandbox.error) {
      return { state: "failed", detail: "unavailable" };
    }
    return last.sandbox.passed
      ? { state: "done", detail: `passed · ${formatDuration(last.sandbox.duration_ms)}` }
      : { state: "failed", detail: last.sandbox.timed_out ? "timed out" : `failed · exit ${last.sandbox.exit_code}` };
  }
  return { state: "pending", detail: "" };
}

function stageFromVerdict(model) {
  if (model.error) {
    return { state: "failed", detail: "run failed" };
  }
  if (!model.done) {
    return { state: "pending", detail: "" };
  }
  switch (model.verdict) {
    case "VERIFIED":
      return { state: "done", detail: repairCount(model) > 0 ? `repaired ×${repairCount(model)}` : "verified" };
    case "FAILED_VERIFICATION":
      return { state: "failed", detail: "not verified" };
    case "UNVERIFIED":
      return { state: "skipped", detail: "unverified" };
    default:
      return { state: "pending", detail: "" };
  }
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
