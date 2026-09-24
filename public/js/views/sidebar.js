import { h } from "../dom.js";
import { icon } from "../icons.js";
import { VERDICT_ICON, VERDICT_LABEL, plural, timeAgo } from "../format.js";
import { formatDuration } from "../runModel.js";

function scenarioItem(scenario, { selected, onSelect }) {
  const blocked = scenario.tags.some((tag) => /blocked/i.test(tag));
  return h(
    "li",
    {},
    h(
      "button",
      {
        class: "incident",
        type: "button",
        "aria-current": selected ? "true" : null,
        "data-focus-id": `scenario:${scenario.id}`,
        onclick: () => onSelect(scenario.id),
      },
      h("span", { class: "incident-title" }, blocked ? icon("lock", 13) : null, scenario.title),
      h("span", { class: "incident-meta" }, scenario.incident.service_name, " · ", scenario.tags.slice(0, 2).join(" · "))
    )
  );
}

/** Arrow keys move between incidents, so the list is one tab stop. */
function withArrowNavigation(list) {
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...list.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next = buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  });
  return list;
}

function runItem(run, { active, scenarioTitle, onOpen }) {
  const running = run.status === "running";
  const verdictIcon = running ? "spinner" : run.status === "failed" ? "warning" : (VERDICT_ICON[run.verdict] ?? "skipped");
  const label = running ? "Running" : run.status === "failed" ? "Run failed" : (VERDICT_LABEL[run.verdict] ?? "Finished");

  return h(
    "li",
    {},
    h(
      "button",
      {
        class: "run-item",
        type: "button",
        "aria-current": active ? "true" : null,
        "data-focus-id": `run:${run.id}`,
        onclick: () => onOpen(run.id),
      },
      h("span", { class: `run-icon run-icon-${running ? "running" : (run.verdict ?? "failed").toLowerCase()}` }, icon(verdictIcon, 14)),
      h(
        "span",
        { class: "run-text" },
        h("span", { class: "run-title" }, scenarioTitle ?? run.serviceName),
        h(
          "span",
          { class: "run-meta" },
          label,
          run.attempts > 1 ? ` · ${plural(run.attempts, "attempt")}` : "",
          run.durationMs !== null ? ` · ${formatDuration(run.durationMs)}` : "",
          ` · ${timeAgo(run.createdAt)}`
        )
      )
    )
  );
}

function statsLine(stats) {
  if (!stats || stats.total === 0) return null;
  const parts = [plural(stats.total, "run")];
  if (stats.repaired > 0) parts.push(`${stats.repaired} repaired by the agent`);
  if (stats.byVerdict.BLOCKED > 0) parts.push(`${stats.byVerdict.BLOCKED} blocked`);
  return h("p", { class: "stats-line" }, "Runs on this server: ", parts.join(" · "));
}

function customIncident({ provider, custom, onSubmit }) {
  if (provider === "replay") {
    return h(
      "details",
      { class: "custom" },
      h("summary", {}, "Run your own incident"),
      h(
        "p",
        { class: "muted" },
        "Drafting a fix for your own alert needs a live model. Restart the server with ",
        h("code", {}, "LLM_PROVIDER=ollama"),
        " and this form will be enabled."
      )
    );
  }

  const field = (name, label, control) => h("label", { class: "field" }, h("span", {}, label), control);
  const form = h(
    "form",
    { class: "custom-form", novalidate: true },
    field("service_name", "Service", h("input", { name: "service_name", required: true, autocomplete: "off", placeholder: "checkout-api" })),
    field("target_file_path", "Missing file", h("input", { name: "target_file_path", required: true, autocomplete: "off", placeholder: "/app/src/utils/retry.js" })),
    field("error_log", "Error log", h("textarea", { name: "error_log", required: true, rows: 4, placeholder: "Paste the crash output" })),
    field(
      "service_requirements_context",
      "What the file must do",
      h("textarea", { name: "service_requirements_context", required: true, rows: 3, placeholder: "Describe the behaviour callers expect" })
    ),
    custom.error ? h("p", { class: "form-error", role: "alert" }, custom.error) : null,
    h("button", { class: "button button-primary", type: "submit", disabled: custom.busy }, custom.busy ? "Starting…" : "Run incident")
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmit(Object.fromEntries(new FormData(form)));
  });

  return h("details", { class: "custom", open: custom.error ? true : null }, h("summary", {}, "Run your own incident"), form);
}

export function buildSidebar({ scenarios, selectedId, runs, activeRunId, stats, provider, custom, onSelect, onOpenRun, onCustomSubmit }) {
  const titles = new Map(scenarios.map((scenario) => [scenario.id, scenario.title]));

  return [
    h("h2", { class: "sidebar-heading", id: "incidents-heading" }, "Incidents"),
    h(
      "p",
      { class: "sidebar-note" },
      "Each one is a synthetic outage: a service is crashing because a file is missing."
    ),
    withArrowNavigation(
      h(
        "ul",
        { class: "incident-list", "aria-labelledby": "incidents-heading" },
        scenarios.map((scenario) => scenarioItem(scenario, { selected: scenario.id === selectedId, onSelect }))
      )
    ),
    runs.length > 0
      ? h(
          "div",
          { class: "history" },
          h("h2", { class: "sidebar-heading", id: "history-heading" }, "History"),
          withArrowNavigation(
            h(
              "ul",
              { class: "run-list", "aria-labelledby": "history-heading" },
              runs.slice(0, 12).map((run) => runItem(run, { active: run.id === activeRunId, scenarioTitle: titles.get(run.scenarioId), onOpen: onOpenRun }))
            )
          ),
          statsLine(stats)
        )
      : null,
    customIncident({ provider, custom, onSubmit: onCustomSubmit }),
  ];
}
