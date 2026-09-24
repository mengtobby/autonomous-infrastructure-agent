import { h } from "../dom.js";
import { icon } from "../icons.js";
import { VERDICT_ICON, outcomeHeadline, plural } from "../format.js";
import { describeNow } from "../narrative.js";
import { repairCount } from "../runModel.js";

const SANDBOX_LABEL = { docker: "Docker sandbox", local: "Local sandbox (not isolated)" };

/** The outcome, stated plainly. Colour, icon and words all agree. */
export function buildVerdict({ model }) {
  if (!model.done || model.error) return null;

  const verdict = model.verdict ?? "UNVERIFIED";
  const facts = [];
  if (model.attempts.length > 0) facts.push(plural(model.attempts.length, "attempt"));
  if (model.plan?.sandbox_mode) facts.push(SANDBOX_LABEL[model.plan.sandbox_mode]);

  return h(
    "section",
    { class: `verdict verdict-${verdict.toLowerCase().replace(/_/g, "-")}`, role: "status", "aria-label": "Outcome" },
    h("span", { class: "verdict-badge" }, icon(VERDICT_ICON[verdict] ?? "info", 22)),
    h(
      "div",
      { class: "verdict-text" },
      h("p", { class: "verdict-headline" }, outcomeHeadline(verdict, repairCount(model))),
      h("p", { class: "verdict-body" }, describeNow(model, null).text)
    ),
    facts.length > 0 ? h("p", { class: "verdict-facts" }, facts.join(" · ")) : null
  );
}
