import { diffLines, diffStats } from "../diff.js";
import { h } from "../dom.js";
import { highlight, languageFor, renderLine } from "../highlight.js";
import { icon } from "../icons.js";
import { formatDuration, latestAttempt } from "../runModel.js";
import { plural } from "../format.js";

/** Unchanged runs longer than this are folded so the change itself stands out. */
const FOLD_OVER = 8;
const CONTEXT = 3;

/** Which tab is showing: an explicit choice, or the most telling default.
 * When the agent repaired itself, the change between attempts is the story. */
export function resolveTab(model, tab) {
  const attempts = model.attempts;
  if (tab !== "auto") {
    if (tab === "changes" && attempts.length > 1) return "changes";
    if (tab.startsWith("attempt:") && attempts.some((a) => `attempt:${a.n}` === tab)) return tab;
  }
  return model.done && attempts.length > 1 ? "changes" : `attempt:${attempts[attempts.length - 1]?.n ?? 1}`;
}

function attemptStatus(attempt, model) {
  if (attempt.drafting) return { icon: "spinner", word: "Drafting", tone: "active" };
  if (attempt.passed === true) return { icon: "check", word: "Passed", tone: "done" };
  if (attempt.passed === false) return { icon: "x", word: "Failed", tone: "failed" };
  if (attempt.lintIssues?.length) return { icon: "x", word: "Rejected", tone: "failed" };
  if (model.done) return { icon: "skipped", word: "Not run", tone: "skipped" };
  return { icon: "spinner", word: "Checking", tone: "active" };
}

function tabs({ model, active, onTab }) {
  const items = [];
  if (model.attempts.length > 1) items.push(["changes", "Changes", null]);
  model.attempts.forEach((attempt) => items.push([`attempt:${attempt.n}`, `Attempt ${attempt.n}`, attemptStatus(attempt, model)]));

  return h(
    "div",
    { class: "tabs", role: "tablist", "aria-label": "Drafts" },
    items.map(([id, label, status]) =>
      h(
        "button",
        {
          class: "tab",
          role: "tab",
          type: "button",
          id: `tab-${id.replace(":", "-")}`,
          "aria-selected": id === active ? "true" : "false",
          tabindex: id === active ? "0" : "-1",
          "data-focus-id": `tab:${id}`,
          onclick: () => onTab(id),
          onkeydown: (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const ids = items.map((item) => item[0]);
            const next = ids[(ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
            onTab(next);
          },
        },
        status ? h("span", { class: `tab-status tab-status-${status.tone}` }, icon(status.icon, 13)) : icon("repair", 13),
        h("span", {}, label),
        status ? h("span", { class: "visually-hidden" }, ` (${status.word})`) : null
      )
    )
  );
}

function lineRow({ oldNo, newNo, sign, cls, html }) {
  return h(
    "div",
    { class: `line ${cls}` },
    h("span", { class: "ln", "aria-hidden": "true" }, oldNo ?? ""),
    h("span", { class: "ln", "aria-hidden": "true" }, newNo ?? ""),
    h("span", { class: "sign", "aria-hidden": "true" }, sign),
    h("code", { html: html || "&nbsp;" })
  );
}

function codeBody(content, language) {
  const lines = highlight(content, language);
  return h(
    "div",
    { class: "code", role: "region", "aria-label": "Drafted code", tabindex: 0 },
    lines.map((tokens, index) => lineRow({ oldNo: null, newNo: index + 1, sign: "", cls: "line-eq", html: renderLine(tokens) }))
  );
}

function diffBody(before, after, language) {
  const ops = diffLines(before, after);
  const beforeLines = highlight(before, language);
  const afterLines = highlight(after, language);

  const rows = ops.map((op) => {
    const tokens = op.type === "del" ? beforeLines[op.oldNo - 1] : afterLines[op.newNo - 1];
    return lineRow({
      oldNo: op.oldNo,
      newNo: op.newNo,
      sign: op.type === "add" ? "+" : op.type === "del" ? "−" : "",
      cls: `line-${op.type}`,
      html: renderLine(tokens ?? [], op.range),
    });
  });

  return h("div", { class: "code code-diff", role: "region", "aria-label": "Changes between drafts", tabindex: 0 }, foldUnchanged(ops, rows));
}

/** Collapses long unchanged stretches behind a button, keeping a little context. */
function foldUnchanged(ops, rows) {
  const output = [];
  let index = 0;

  while (index < ops.length) {
    if (ops[index].type !== "eq") {
      output.push(rows[index]);
      index += 1;
      continue;
    }

    const start = index;
    while (index < ops.length && ops[index].type === "eq") index += 1;
    const run = rows.slice(start, index);

    if (run.length <= FOLD_OVER) {
      output.push(...run);
      continue;
    }

    const head = start === 0 ? 0 : CONTEXT;
    const tail = index === ops.length ? 0 : CONTEXT;
    const hidden = run.slice(head, run.length - tail);
    output.push(...run.slice(0, head));
    output.push(foldButton(hidden));
    output.push(...run.slice(run.length - tail));
  }
  return output;
}

function foldButton(hiddenRows) {
  const button = h(
    "button",
    { class: "fold", type: "button", onclick: () => button.replaceWith(...hiddenRows) },
    icon("chevron", 13),
    `Show ${plural(hiddenRows.length, "unchanged line")}`
  );
  return button;
}

function copyButton(text) {
  const button = h("button", { class: "button button-ghost button-small", type: "button" }, icon("copy", 14), h("span", {}, "Copy"));
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.lastChild.textContent = "Copied";
    } catch {
      button.lastChild.textContent = "Copy failed";
    }
    setTimeout(() => (button.lastChild.textContent = "Copy"), 1600);
  });
  return button;
}

function codePanel({ model, incident, active }) {
  const language = languageFor(incident.target_file_path);

  if (active === "changes") {
    const attempts = model.attempts;
    const after = attempts[attempts.length - 1];
    const before = attempts[attempts.length - 2];
    const stats = diffStats(diffLines(before.content, after.content));
    return h(
      "div",
      { class: "panel code-panel", role: "tabpanel", "aria-labelledby": "tab-changes" },
      h(
        "div",
        { class: "panel-head" },
        h("code", { class: "path" }, incident.target_file_path),
        h("span", { class: "diff-stats" }, h("span", { class: "add" }, `+${stats.added}`), " ", h("span", { class: "del" }, `−${stats.removed}`)),
        h("span", { class: "muted" }, `Attempt ${before.n} to attempt ${after.n}`),
        copyButton(after.content)
      ),
      diffBody(before.content, after.content, language)
    );
  }

  const attempt = model.attempts.find((candidate) => `attempt:${candidate.n}` === active) ?? latestAttempt(model);
  const status = attemptStatus(attempt, model);
  return h(
    "div",
    { class: "panel code-panel", role: "tabpanel", "aria-labelledby": `tab-attempt-${attempt.n}` },
    h(
      "div",
      { class: "panel-head" },
      h("code", { class: "path" }, incident.target_file_path),
      h("span", { class: `status-pill status-pill-${status.tone}` }, icon(status.icon, 13), status.word),
      attempt.summary ? h("span", { class: "muted panel-summary" }, attempt.summary) : null,
      attempt.content ? copyButton(attempt.content) : null
    ),
    attempt.drafting ? skeleton("The model is writing the file…") : codeBody(attempt.content, language)
  );
}

function skeleton(label) {
  return h("div", { class: "skeleton", role: "status" }, h("span", { class: "skeleton-bar" }), h("span", { class: "skeleton-bar short" }), h("span", { class: "visually-hidden" }, label), h("p", { class: "muted" }, label));
}

const OUTPUT_ERROR = /(assertion|error|exception|traceback|failed)/i;

function outputLines(text) {
  return text
    .replace(/\s+$/, "")
    .split(/\r?\n/)
    .map((line) => h("div", { class: OUTPUT_ERROR.test(line) ? "out-line out-error" : "out-line" }, line || " "));
}

function consoleBlock(attempt, { title }) {
  const status = attemptStatus(attempt, { done: true });
  const result = attempt.sandbox;

  let body;
  if (attempt.lintIssues && attempt.lintIssues.length > 0) {
    body = h(
      "div",
      { class: "console-body" },
      h("p", {}, `The static checks rejected this draft, so it was not run. ${plural(attempt.lintIssues.length, "problem")}:`),
      h("ul", { class: "issue-list" }, attempt.lintIssues.map((issue) => h("li", {}, issue)))
    );
  } else if (attempt.sandboxState === "running") {
    body = skeleton("Running the draft's tests…");
  } else if (!result) {
    body = h("div", { class: "console-body" }, h("p", { class: "muted" }, attempt.drafting ? "Waiting for the draft." : "Waiting for the static checks."));
  } else if (result.error) {
    body = h("div", { class: "console-body" }, h("p", { class: "out-error" }, result.error));
  } else {
    body = [
      h(
        "details",
        { class: "command" },
        h("summary", {}, plural(attempt.commands.length, "test command")),
        h("pre", {}, attempt.commands.join("\n"))
      ),
      result.stderr.trim() ? h("div", { class: "output", tabindex: 0, role: "region", "aria-label": "Standard error" }, outputLines(result.stderr)) : null,
      result.stdout.trim() ? h("div", { class: "output", tabindex: 0, role: "region", "aria-label": "Standard output" }, outputLines(result.stdout)) : null,
      !result.stderr.trim() && !result.stdout.trim() ? h("p", { class: "muted console-body" }, "The run printed nothing.") : null,
      h(
        "p",
        { class: "console-foot" },
        result.timed_out ? "Timed out" : `Exit code ${result.exit_code}`,
        ` · ${formatDuration(result.duration_ms)}`,
        attempt.sandboxMode ? ` · ${attempt.sandboxMode} sandbox` : ""
      ),
    ];
  }

  return h(
    "div",
    { class: "panel console" },
    h("div", { class: "panel-head" }, icon("terminal", 14), h("span", { class: "console-title" }, title), h("span", { class: `status-pill status-pill-${status.tone}` }, icon(status.icon, 13), status.word)),
    body
  );
}

function consolePanel({ model, active }) {
  const attempts = model.attempts;
  if (active === "changes") {
    const after = attempts[attempts.length - 1];
    const before = attempts[attempts.length - 2];
    return h(
      "div",
      { class: "console-stack" },
      consoleBlock(before, { title: `Why attempt ${before.n} was rejected` }),
      consoleBlock(after, { title: `Then attempt ${after.n} ran` })
    );
  }
  const attempt = attempts.find((candidate) => `attempt:${candidate.n}` === active) ?? latestAttempt(model);
  return h("div", { class: "console-stack" }, consoleBlock(attempt, { title: `Sandbox output · attempt ${attempt.n}` }));
}

export function buildResults({ model, incident, tab, onTab }) {
  if (model.attempts.length === 0) return null;

  const active = resolveTab(model, tab);
  return h(
    "section",
    { class: "results", "aria-labelledby": "results-heading" },
    h("div", { class: "results-head" }, h("h2", { id: "results-heading" }, "What the agent wrote"), tabs({ model, active, onTab })),
    h("div", { class: "results-body" }, codePanel({ model, incident, active }), consolePanel({ model, active }))
  );
}

/** Root-cause analysis written by the model, shown once the run has produced it. */
export function buildDiagnosis({ model }) {
  const analysis = model.plan?.root_cause_analysis;
  if (!analysis || model.verdict === "BLOCKED") return null;

  return h(
    "section",
    { class: "diagnosis", "aria-labelledby": "diagnosis-heading" },
    h("h2", { id: "diagnosis-heading" }, "The agent's diagnosis"),
    h("p", {}, h("code", {}, analysis.error_type), " in ", h("code", {}, analysis.failing_component)),
    h("p", {}, analysis.detailed_explanation)
  );
}

// Exported for tests.
export { attemptStatus };
