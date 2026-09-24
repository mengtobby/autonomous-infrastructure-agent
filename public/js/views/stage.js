import { h } from "../dom.js";
import { icon } from "../icons.js";
import { describeNow } from "../narrative.js";
import { plural } from "../format.js";
import { repairCount, stageStates } from "../runModel.js";

const STAGES = [
  ["policy", "Policy gate", "shield"],
  ["draft", "Draft", "draft"],
  ["checks", "Static checks", "checks"],
  ["sandbox", "Sandbox", "terminal"],
  ["verdict", "Verdict", "verdict"],
];

/** A settled stage shows what happened (check, cross, …); an open one shows what it is. */
const STATE_ICON = { done: "check", failed: "x", blocked: "ban", skipped: "skipped" };

const STATE_WORD = {
  pending: "waiting",
  active: "in progress",
  done: "done",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
};

function stageItem([key, label, iconName], stage) {
  const glyph = STATE_ICON[stage.state] ?? iconName;
  return h(
    "li",
    { class: `stage stage-${stage.state}`, "data-stage": key },
    h("span", { class: "stage-mark" }, icon(stage.state === "active" ? "spinner" : glyph, 15)),
    h(
      "span",
      { class: "stage-text" },
      h("span", { class: "stage-label" }, label),
      h("span", { class: "stage-detail" }, stage.detail || STATE_WORD[stage.state]),
      // Colour is never the only signal: the state is also spoken.
      h("span", { class: "visually-hidden" }, ` (${STATE_WORD[stage.state]})`)
    )
  );
}

export function buildStage({ model, scenario, maxRepairs }) {
  const stages = stageStates(model);
  const now = describeNow(model, scenario);
  const repairs = repairCount(model);
  const toneIcon = { active: "spinner", success: "check", failure: "x", blocked: "ban", warning: "warning", idle: "info" }[now.tone];

  return h(
    "section",
    { class: "stage-block", "aria-labelledby": "stage-heading" },
    h("h2", { id: "stage-heading" }, "What the agent does"),
    // Once the verdict banner is showing it says the same thing, so the caption steps aside.
    model.done && !model.error
      ? null
      : h("p", { class: `caption caption-${now.tone}`, role: "status", "aria-live": "polite" }, icon(toneIcon, 16), h("span", {}, now.text)),
    h("ol", { class: "stepper" }, STAGES.map((stage) => stageItem(stage, stages[stage[0]]))),
    repairs > 0
      ? h(
          "p",
          { class: "repair-note" },
          icon("repair", 14),
          `Repair loop: the agent has sent its draft back ${plural(repairs, "time")} (up to ${maxRepairs} allowed).`
        )
      : null,
    model.policy
      ? h(
          "p",
          { class: "policy-note" },
          icon("shield", 14),
          h("span", {}, model.policy.risk_reasoning, " ", h("em", {}, "Decided from the file path only."))
        )
      : null
  );
}
