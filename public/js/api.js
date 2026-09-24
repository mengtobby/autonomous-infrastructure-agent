// Thin client for the agent's HTTP API. Every failure is translated into an
// ApiError whose message says what went wrong and what to do about it.

export class ApiError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const FRIENDLY = {
  too_many_runs: "The agent is already busy with other runs. Wait a moment for one to finish, then try again.",
  rate_limited: "Too many requests in a short time. Wait a minute and try again.",
  unknown_scenario: "That incident no longer exists. Reload the page to refresh the list.",
  invalid_run_request: "Some of the incident details are missing or invalid.",
};

async function request(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError("Cannot reach the agent server. Check that it is still running, then reload.");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.error ?? "";
    throw new ApiError(FRIENDLY[code] ?? body?.message ?? `The server answered with an error (${response.status}).`, {
      status: response.status,
      code,
    });
  }
  return body;
}

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getMeta = () => request("/api/meta");
export const getScenarios = () => request("/api/scenarios");
export const getRuns = () => request("/api/runs");
export const getStats = () => request("/api/stats");
export const getRun = (id) => request(`/api/runs/${encodeURIComponent(id)}`);
export const startScenarioRun = (scenarioId) => request("/api/runs", json({ scenario_id: scenarioId }));
export const startCustomRun = (incident) => request("/api/runs", json({ incident }));

/**
 * Follows a run over Server-Sent Events. The server replays everything so far
 * and then streams live, so opening a finished run and watching a live one
 * are the same code path. Returns a function that stops listening.
 */
export function followRun(runId, { onEvent, onEnd, onLost }) {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  let ended = false;

  source.addEventListener("pipeline", (message) => {
    const timed = JSON.parse(message.data);
    onEvent(timed);
    if (timed.event.type === "run_finished" || timed.event.type === "run_failed") {
      ended = true;
      source.close();
      onEnd();
    }
  });

  source.addEventListener("error", () => {
    // EventSource retries by itself; only give up when it has stopped trying.
    if (!ended && source.readyState === EventSource.CLOSED) {
      onLost();
    }
  });

  return () => {
    ended = true;
    source.close();
  };
}
