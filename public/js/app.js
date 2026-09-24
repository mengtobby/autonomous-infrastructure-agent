import { ApiError, followRun, getMeta, getRun, getRuns, getScenarios, getStats, startCustomRun, startScenarioRun } from "./api.js";
import { h, mount, preservingFocus } from "./dom.js";
import { icon } from "./icons.js";
import { applyEvent, initialModel } from "./runModel.js";
import { applyTheme, getPreference, nextPreference, watchSystemTheme } from "./theme.js";
import { buildAlert, buildIncidentHeader } from "./views/incident.js";
import { buildIntro } from "./views/intro.js";
import { buildDiagnosis, buildResults, resolveTab } from "./views/results.js";
import { buildSidebar } from "./views/sidebar.js";
import { buildStage } from "./views/stage.js";
import { buildTopbar } from "./views/topbar.js";
import { buildVerdict } from "./views/verdict.js";

const INTRO_SEEN_KEY = "intro-dismissed";

const readFlag = (key) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (key) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Not persisting the dismissal is harmless.
  }
};

const state = {
  meta: null,
  scenarios: [],
  runs: [],
  stats: null,
  selectedId: null,
  themePreference: getPreference(),
  introOpen: !readFlag(INTRO_SEEN_KEY),
  tab: "auto",
  notice: null,
  loadError: null,
  custom: { busy: false, error: null },
  run: emptyRun(null, null),
};

function emptyRun(incident, scenarioId) {
  return { id: null, incident, scenarioId, model: initialModel(), running: false, stop: null };
}

const topbar = document.getElementById("topbar");
const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");

const slotNames = ["notice", "intro", "header", "alert", "stage", "verdict", "results", "diagnosis"];
const slots = Object.fromEntries(slotNames.map((name) => [name, h("div", { class: `slot slot-${name}` })]));
main.append(...slotNames.map((name) => slots[name]));

const currentScenario = () => state.scenarios.find((scenario) => scenario.id === state.selectedId) ?? null;

// ---------- actions ----------

function selectScenario(id) {
  const scenario = state.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) return;
  state.run.stop?.();
  state.selectedId = id;
  state.run = emptyRun(scenario.incident, id);
  state.tab = "auto";
  state.notice = null;
  history.replaceState(null, "", `#${id}`);
  render();
}

async function startRun() {
  const scenario = currentScenario();
  if (!scenario || state.run.running) return;

  state.run.stop?.();
  state.run = { ...emptyRun(scenario.incident, scenario.id), running: true };
  state.tab = "auto";
  state.notice = null;
  render();

  try {
    const { id } = await startScenarioRun(scenario.id);
    follow(id);
    refreshSidebarData();
  } catch (error) {
    failStart(error);
  }
}

async function startCustom(values) {
  const incident = {
    incident_id: `CUSTOM-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    ...values,
  };
  state.custom = { busy: true, error: null };
  render();

  try {
    const { id } = await startCustomRun(incident);
    state.run.stop?.();
    state.selectedId = null;
    state.run = { ...emptyRun(incident, null), id, running: true };
    state.tab = "auto";
    state.custom = { busy: false, error: null };
    history.replaceState(null, "", `#run=${id}`);
    follow(id);
    refreshSidebarData();
  } catch (error) {
    state.custom = { busy: false, error: error instanceof ApiError ? error.message : String(error) };
    render();
  }
}

async function openRun(id) {
  try {
    const record = await getRun(id);
    state.run.stop?.();
    state.selectedId = record.scenarioId;
    state.run = { ...emptyRun(record.incident, record.scenarioId), id, running: record.status === "running" };
    state.tab = "auto";
    state.notice = null;
    history.replaceState(null, "", `#run=${id}`);
    follow(id);
    render();
  } catch (error) {
    state.notice = error instanceof ApiError ? error.message : String(error);
    render();
  }
}

function failStart(error) {
  state.run = { ...state.run, running: false };
  state.notice = error instanceof ApiError ? error.message : `Could not start the run: ${String(error)}`;
  render();
}

/** Streams a run's events into the model. Finished runs replay instantly. */
function follow(id) {
  state.run.id = id;
  state.run.stop = followRun(id, {
    onEvent: (timed) => {
      state.run = { ...state.run, model: applyEvent(state.run.model, timed) };
      render();
    },
    onEnd: () => {
      state.run = { ...state.run, running: false };
      refreshSidebarData();
      render();
    },
    onLost: () => {
      state.run = { ...state.run, running: false };
      state.notice = "Lost the connection to the agent before the run finished. Reload the page to see where it got to.";
      render();
    },
  });
}

async function refreshSidebarData() {
  try {
    const [runs, stats] = await Promise.all([getRuns(), getStats()]);
    state.runs = runs;
    state.stats = stats;
    render();
  } catch {
    // The sidebar history is a convenience; a failed refresh must not disturb a run.
  }
}

function toggleTheme() {
  state.themePreference = nextPreference(state.themePreference);
  applyTheme(state.themePreference);
  render();
}

function toggleIntro() {
  state.introOpen = !state.introOpen;
  render();
  if (state.introOpen) slots.intro.scrollIntoView({ behavior: "smooth", block: "start" });
}

function dismissIntro() {
  state.introOpen = false;
  writeFlag(INTRO_SEEN_KEY);
  render();
}

// ---------- rendering ----------

function render() {
  renderTopbar();
  renderSidebar();
  renderMain();
}

function renderTopbar() {
  const key = JSON.stringify([state.meta, state.themePreference]);
  mount(topbar, key, () =>
    buildTopbar({ meta: state.meta, themePreference: state.themePreference, onToggleTheme: toggleTheme, onToggleHelp: toggleIntro })
  );
}

function renderSidebar() {
  if (state.scenarios.length === 0) return;
  const key = JSON.stringify([
    state.selectedId,
    state.run.id,
    state.runs.map((run) => [run.id, run.status, run.verdict, run.attempts]),
    state.stats,
    state.custom,
    state.meta?.provider,
  ]);
  preservingFocus(sidebar, () =>
    mount(sidebar, key, () =>
      buildSidebar({
        scenarios: state.scenarios,
        selectedId: state.selectedId,
        runs: state.runs,
        activeRunId: state.run.id,
        stats: state.stats,
        provider: state.meta?.provider,
        custom: state.custom,
        onSelect: selectScenario,
        onOpenRun: openRun,
        onCustomSubmit: startCustom,
      })
    )
  );
}

function renderMain() {
  const { run } = state;

  mount(slots.notice, String(state.notice), () =>
    state.notice ? h("p", { class: "notice", role: "alert" }, icon("warning", 16), h("span", {}, state.notice)) : null
  );

  mount(slots.intro, String(state.introOpen), () => (state.introOpen ? buildIntro({ onDismiss: dismissIntro }) : null));

  if (state.loadError) {
    mount(slots.header, "load-error", () => h("p", { class: "notice", role: "alert" }, icon("warning", 16), h("span", {}, state.loadError)));
    return;
  }
  if (!run.incident) return;

  const scenario = currentScenario();
  const model = run.model;
  const hasRun = model.started || model.done;

  mount(slots.header, JSON.stringify([run.incident.incident_id, run.running, hasRun]), () =>
    buildIncidentHeader({
      title: scenario?.title ?? "Custom incident",
      incident: run.incident,
      synthetic: Boolean(scenario),
      running: run.running,
      hasRun,
      onRun: startRun,
    })
  );

  mount(slots.alert, run.incident.incident_id, () => buildAlert({ incident: run.incident }));

  const attemptsKey = model.attempts.map((a) => [a.n, a.drafting, a.content.length, a.lintIssues, a.sandboxState, a.passed, a.sandbox?.duration_ms]);
  const stageKey = JSON.stringify([scenario?.id, model.started, model.done, model.policy, model.verdict, model.error, attemptsKey.map((a) => a.slice(0, 2).concat(a.slice(3, 6)))]);
  mount(slots.stage, stageKey, () => buildStage({ model, scenario, maxRepairs: state.meta?.maxRepairAttempts ?? 2 }));

  mount(slots.verdict, JSON.stringify([model.done, model.verdict, model.attempts.length, model.error]), () => buildVerdict({ model }));

  const activeTab = model.attempts.length > 0 ? resolveTab(model, state.tab) : "none";
  mount(slots.results, JSON.stringify([run.incident.incident_id, activeTab, model.done, attemptsKey]), () =>
    buildResults({
      model,
      incident: run.incident,
      tab: state.tab,
      onTab: (tab) => {
        state.tab = tab;
        renderMain();
        document.querySelector(`[data-focus-id="tab:${CSS.escape(tab)}"]`)?.focus();
      },
    })
  );

  mount(slots.diagnosis, String(Boolean(model.plan)), () => buildDiagnosis({ model }));
}

// ---------- keyboard ----------

document.addEventListener("keydown", (event) => {
  if (event.key !== "r" || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]")) return;
  startRun();
});

// ---------- routing ----------

/** The URL hash is the deep link: #<scenario-id> or #run=<run-id>. Handles
 * the first load as well as back/forward and hand-edited links. */
async function routeFromHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith("run=")) {
    const id = hash.slice(4);
    if (id && id !== state.run.id) await openRun(id);
  } else if (hash && hash !== state.selectedId && state.scenarios.some((scenario) => scenario.id === hash)) {
    selectScenario(hash);
  }
}

window.addEventListener("hashchange", () => routeFromHash());

// ---------- boot ----------

async function boot() {
  watchSystemTheme(() => state.themePreference);
  render();

  try {
    const [meta, scenarios, runs, stats] = await Promise.all([getMeta(), getScenarios(), getRuns(), getStats()]);
    Object.assign(state, { meta, scenarios, runs, stats });
  } catch (error) {
    state.loadError = error instanceof ApiError ? error.message : "Could not load the agent's incidents.";
    render();
    return;
  }

  await routeFromHash();
  if (!state.run.incident) {
    selectScenario(state.scenarios[0]?.id);
  }
  render();
}

boot();
