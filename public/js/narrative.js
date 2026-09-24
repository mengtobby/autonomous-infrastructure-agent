// Plain-language commentary on what the agent is doing right now. The page
// is opened alone from a link, so it has to narrate itself: this is the
// caption a founder would speak if they were sitting next to the visitor.

import { latestAttempt, repairCount } from "./runModel.js";

const RISK_WORDS = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };

/**
 * @param {ReturnType<import('./runModel.js').initialModel>} model
 * @param {{blurb?: string}|null} scenario
 * @returns {{tone: 'idle'|'active'|'success'|'failure'|'blocked'|'warning', text: string}}
 */
export function describeNow(model, scenario) {
  if (model.error) {
    return { tone: "failure", text: explainRunError(model.error) };
  }

  if (!model.started) {
    return { tone: "idle", text: scenario?.blurb ?? "Pick an incident and run it to watch the agent work." };
  }

  if (!model.policy) {
    return {
      tone: "active",
      text: "Checking whether the agent is allowed to touch this file. That decision uses only the file path, never the text of the alert.",
    };
  }

  if (model.done) {
    return describeOutcome(model);
  }

  if (!model.policy.is_safe_to_remediate) {
    return { tone: "blocked", text: "Blocked before any AI model was called." };
  }

  return describeProgress(model);
}

function describeProgress(model) {
  const last = latestAttempt(model);

  if (!last || last.drafting) {
    return last?.kind === "repair"
      ? { tone: "active", text: "Sending the real failure output back to the model and asking for a corrected version." }
      : { tone: "active", text: "Policy gate passed. Asking the model to write the missing file." };
  }
  if (last.lintIssues === null) {
    return { tone: "active", text: "Running fast static checks on the draft before executing anything." };
  }
  if (last.lintIssues.length > 0) {
    return { tone: "failure", text: "The static checks found problems with the draft. Sending them back for a repair." };
  }
  if (last.sandboxState === "running") {
    return { tone: "active", text: "Running the draft's own tests in a sandbox. The code is really being executed." };
  }
  if (last.sandboxState === "done" && last.sandbox && !last.sandbox.passed) {
    return { tone: "failure", text: "The tests failed. This is the moment the agent has to catch its own mistake." };
  }
  return { tone: "active", text: "Working…" };
}

function describeOutcome(model) {
  const repairs = repairCount(model);

  switch (model.verdict) {
    case "VERIFIED":
      return repairs > 0
        ? {
            tone: "success",
            text: `Fixed. The first draft failed its tests; after ${repairs === 1 ? "one repair" : `${repairs} repairs`} the same tests pass. The fix was proven by running it, not assumed.`,
          }
        : { tone: "success", text: "The draft passed its tests on the first try, so the fix is proven by execution." };
    case "FAILED_VERIFICATION":
      return {
        tone: "failure",
        text: `The agent could not produce a passing fix in ${model.attempts.length} attempt${model.attempts.length === 1 ? "" : "s"}, so nothing was accepted. Failing safe is the correct outcome here.`,
      };
    case "UNVERIFIED":
      return { tone: "warning", text: model.plan?.verification_note ?? "The draft was not executed, so it is unproven." };
    case "BLOCKED":
      return {
        tone: "blocked",
        text: `Blocked. The policy gate rates this path ${RISK_WORDS[model.policy?.risk_level] ?? "unsafe"} risk from the file path alone, so no AI model was called and nothing was written.`,
      };
    default:
      return { tone: "idle", text: "" };
  }
}

/** Turns a server error into what happened and what to do about it. */
export function explainRunError(message) {
  if (/no recording for incident/i.test(message)) {
    return "Replay mode only has recorded drafts for the built-in incidents. To try your own, restart the server with LLM_PROVIDER=ollama.";
  }
  if (/ollama/i.test(message) && /(running|pull|failed|timed out)/i.test(message)) {
    return "The local model did not answer. Check that Ollama is running and the model is pulled, then run the incident again.";
  }
  return `The run failed: ${message}`;
}
