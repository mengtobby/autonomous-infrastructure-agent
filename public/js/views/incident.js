import { h } from "../dom.js";
import { icon } from "../icons.js";

/** Title, where it happened, and the Run button. */
export function buildIncidentHeader({ title, incident, synthetic, running, hasRun, onRun }) {
  return h(
    "div",
    { class: "incident-header" },
    h(
      "div",
      { class: "incident-heading" },
      h("h1", {}, title),
      h(
        "p",
        { class: "incident-where" },
        h("span", {}, incident.service_name),
        h("code", {}, incident.target_file_path),
        synthetic ? h("span", { class: "tag" }, "Synthetic incident") : null
      )
    ),
    h(
      "button",
      { class: "button button-primary button-large", type: "button", onclick: onRun, disabled: running, "data-focus-id": "run-button" },
      running ? [icon("spinner", 16), "Running…"] : [icon(hasRun ? "repair" : "play", 16), hasRun ? "Run again" : "Run this incident"]
    )
  );
}

/** The alert the agent received: what crashed and what the service needs. */
export function buildAlert({ incident }) {
  return h(
    "section",
    { class: "alert-block", "aria-labelledby": "alert-heading" },
    h("h2", { id: "alert-heading" }, "What happened"),
    h(
      "div",
      { class: "alert-grid" },
      h(
        "figure",
        { class: "terminal" },
        h("figcaption", {}, "Error log from ", incident.service_name),
        h("pre", { tabindex: 0 }, incident.error_log)
      ),
      h(
        "div",
        { class: "requirements" },
        h("h3", {}, "What the service needs"),
        h("p", {}, incident.service_requirements_context)
      )
    )
  );
}
