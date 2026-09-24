import { h } from "../dom.js";
import { icon } from "../icons.js";

const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" };
const THEME_NEXT_LABEL = { system: "light", light: "dark", dark: "system" };

/** What to tell the viewer about where the model and the sandbox come from.
 * These are the two places a demo could be mistaken for something it is not,
 * so they are always visible and always explain themselves. */
export function describeTruth(meta) {
  const model =
    meta.provider === "replay"
      ? {
          icon: "cpu",
          label: "Recorded drafts",
          tone: "notice",
          title: "Replay mode",
          body: "The model's drafts for these incidents were recorded ahead of time, so this demo needs no GPU. Everything after drafting genuinely runs: the policy gate, the static checks, the sandbox execution and the repair loop.",
        }
      : {
          icon: "cpu",
          label: `Local model · ${meta.model}`,
          tone: "neutral",
          title: "Live local model",
          body: "Drafts are written by a model running on this machine through Ollama. No source code or logs are sent to a cloud service.",
        };

  const sandbox = meta.sandbox;
  let box;
  if (sandbox.mode === "local") {
    box = {
      icon: "warning",
      label: "Local sandbox · not isolated",
      tone: "warning",
      title: "Local sandbox",
      body: "Drafted code is really executed, as a child process with a scrubbed environment and a hard timeout, but without network or filesystem isolation. It is used here because every incident is one of our own recorded, synthetic examples. Production use should run the Docker sandbox.",
    };
  } else if (sandbox.mode === "docker" && sandbox.available) {
    box = {
      icon: "box",
      label: "Docker sandbox",
      tone: "neutral",
      title: "Docker sandbox",
      body: "Drafted code runs in a container with networking disabled, CPU, memory and process limits, and a read-only mount. A timed-out container is killed by name.",
    };
  } else if (sandbox.mode === "docker") {
    box = {
      icon: "warning",
      label: "Sandbox unavailable",
      tone: "warning",
      title: "Docker is not available",
      body: "The Docker sandbox is configured but Docker is not reachable, so drafts cannot be executed and every run ends Unverified rather than claiming a fix works.",
    };
  } else {
    box = {
      icon: "warning",
      label: "Verification off",
      tone: "warning",
      title: "No sandbox",
      body: "Verification is switched off, so drafts are written but never executed. Every run ends Unverified.",
    };
  }
  return { model, sandbox: box };
}

function truthChip(id, chip) {
  const popover = h("div", { id, class: "popover", popover: "auto" }, h("h3", {}, chip.title), h("p", {}, chip.body));
  const button = h(
    "button",
    { class: `chip chip-${chip.tone}`, type: "button", popovertarget: id },
    icon(chip.icon, 14),
    h("span", {}, chip.label),
    icon("info", 13)
  );

  popover.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const rect = button.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`;
  });

  return [button, popover];
}

export function buildTopbar({ meta, themePreference, onToggleTheme, onToggleHelp }) {
  const truth = meta ? describeTruth(meta) : null;

  return [
    h("div", { class: "brand" }, h("span", { class: "brand-name" }, "Autonomous Infra Agent")),
    h(
      "div",
      { class: "topbar-chips" },
      truth ? [truthChip("pop-model", truth.model), truthChip("pop-sandbox", truth.sandbox)] : null
    ),
    h(
      "div",
      { class: "topbar-actions" },
      h("button", { class: "button button-ghost", type: "button", onclick: onToggleHelp }, icon("help", 15), h("span", {}, "How it works")),
      h(
        "button",
        {
          class: "button button-icon",
          type: "button",
          onclick: onToggleTheme,
          "aria-label": `Theme: ${themePreference}. Switch to ${THEME_NEXT_LABEL[themePreference]}.`,
          title: `Theme: ${themePreference}`,
        },
        icon(THEME_ICON[themePreference], 16)
      )
    ),
  ];
}
