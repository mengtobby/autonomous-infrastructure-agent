import { h } from "../dom.js";
import { icon } from "../icons.js";

const STEPS = [
  ["Policy gate", "Decides from the file path alone whether the agent may act at all. Text inside an alert cannot change that decision."],
  ["Draft", "A language model writes the missing file."],
  ["Static checks", "Quick automated checks catch common mistakes before anything is executed."],
  ["Sandbox", "The draft's own tests are run for real. If they fail, the actual failure output goes back to the model for a repair."],
];

const VERDICTS = [
  ["check", "Verified", "the tests passed."],
  ["x", "Not verified", "every attempt failed, so nothing is accepted."],
  ["warning", "Unverified", "the draft could not be run."],
  ["ban", "Blocked", "the policy gate refused before any model was called."],
];

/** Shown first to a visitor arriving alone from a link: what this is, in plain terms. */
export function buildIntro({ onDismiss }) {
  return h(
    "section",
    { class: "intro", "aria-labelledby": "intro-heading" },
    h("h2", { id: "intro-heading" }, "What you're looking at"),
    h(
      "p",
      { class: "intro-lede" },
      "A microservice is crashing because a file is missing. An AI agent reads the alert, writes the file, and then ",
      h("strong", {}, "proves its fix by actually running it"),
      ". If the proof fails, it reads the real error and tries again. Pick an incident and press Run."
    ),
    h(
      "dl",
      { class: "intro-steps" },
      STEPS.map(([term, description]) => h("div", {}, h("dt", {}, term), h("dd", {}, description)))
    ),
    h(
      "div",
      { class: "intro-foot" },
      h(
        "ul",
        { class: "intro-verdicts", "aria-label": "Possible outcomes" },
        VERDICTS.map(([iconName, label, meaning]) =>
          h("li", {}, h("span", { class: `verdict-mark verdict-mark-${label.toLowerCase().replace(" ", "-")}` }, icon(iconName, 13)), h("strong", {}, label), " ", meaning)
        )
      ),
      h("button", { class: "button button-secondary", type: "button", onclick: onDismiss }, "Got it")
    )
  );
}
