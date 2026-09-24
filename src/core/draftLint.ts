import { posix } from "node:path";
import type { LlmRemediationDraft } from "../schemas/remediation.schema.js";

const JSON_FILE = /\.(json|jsonc|json5)$/i;
const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;
const MARKDOWN_FENCE = /^\s*```/m;
const JSON_OBJECT_START = /^\{\s*"[^"\n]+"\s*:/;

/** TODO/FIXME are matched case-sensitively so prose like "todo items" or an
 * identifier like TodoList isn't mistaken for an unfinished stub. Raising
 * NotImplemented(Error) is a stub; merely *returning* NotImplemented (the
 * Python binary-operator protocol) is legitimate code. */
const PLACEHOLDER_MARKER = /\b(?:TODO|FIXME)\b/;
const PLACEHOLDER_PHRASE = /raise\s+NotImplemented(?:Error)?\b|implement (?:me|later)|your code here/i;

/** Commands that need network or the host — pointless (and misleading) in a
 * sandbox that has no network and no Docker socket. Program names are only
 * matched in command position, so a path like "docker-compose.yml" or an
 * argument that merely mentions curl does not trigger it. */
const UNAVAILABLE_COMMAND =
  /(?:^|[;&|]\s*)(?:sudo|docker|curl|wget)\s|\b(?:pip3?\s+install|npm\s+(?:install|i|ci)|yarn\s+add|apt(?:-get)?\s+install|apk\s+add|git\s+clone)\b/i;

/** `python -c '…'` works in POSIX shells but not in Windows cmd.exe, where a
 * single quote is an ordinary character. Double quotes work in both. */
const SINGLE_QUOTED_PROGRAM = /(?:^|\s)-[ce]\s+'/;

const MAX_PATTERN_LENGTH = 300;

/** Non-empty strings a real success marker must NOT match: arbitrary text and
 * what a crash looks like. A pattern that matches all of them proves nothing,
 * however it is spelled. */
const PROBES = ["zzz", "Some unrelated output", "Traceback (most recent call last):\nError: boom"];

/** Names too generic to identify a file; the parent directory names it instead. */
const GENERIC_STEMS = new Set(["__init__", "index", "main"]);

/**
 * Problems with the file itself: things that are wrong no matter what the
 * tests are. Each message is phrased as an instruction to the model, because
 * it is fed back verbatim if the draft has to be repaired.
 */
export function lintFile(draft: LlmRemediationDraft, targetFilePath: string): string[] {
  const issues: string[] = [];
  const content = draft.full_file_content;
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return ["full_file_content is empty. Provide the complete source code of the file."];
  }

  if (!JSON_FILE.test(targetFilePath) && JSON_OBJECT_START.test(trimmed)) {
    issues.push(
      `full_file_content is a JSON object, not source code. It must be the raw text of ${targetFilePath} itself, ` +
        "not JSON that describes the code."
    );
  }

  if (!MARKDOWN_FILE.test(targetFilePath) && MARKDOWN_FENCE.test(content)) {
    issues.push("full_file_content contains markdown code fences (```). Return the raw file text with no fences.");
  }

  if (PLACEHOLDER_MARKER.test(content) || PLACEHOLDER_PHRASE.test(content)) {
    issues.push("full_file_content contains a placeholder (TODO / raise NotImplementedError / 'implement later'). Implement everything fully.");
  }

  return issues;
}

/**
 * Problems with the tests. These matter most: the model writes the code AND
 * the tests that prove it, so a test that never touches the drafted file, or a
 * success marker that matches anything, would make VERIFIED meaningless.
 */
export function lintTests(draft: LlmRemediationDraft, targetFilePath: string): string[] {
  const issues: string[] = [];

  if (draft.test_commands.some((command) => command.trim().length === 0)) {
    issues.push("test_commands contains an empty command.");
  }

  const unavailable = draft.test_commands.find((command) => UNAVAILABLE_COMMAND.test(command));
  if (unavailable) {
    issues.push(
      `test_commands uses a command that cannot work in the sandbox (no network, no Docker, no package installs): "${unavailable}". ` +
        "Use only the language runtime and the standard library."
    );
  }

  const singleQuoted = draft.test_commands.find((command) => SINGLE_QUOTED_PROGRAM.test(command));
  if (singleQuoted) {
    issues.push(
      `test_commands wraps a program in single quotes ("${truncate(singleQuoted)}"), which fails on Windows. ` +
        "Wrap it in double quotes and use single quotes inside the program instead."
    );
  }

  if (!testsExerciseFile(draft.test_commands, targetFilePath)) {
    issues.push(
      `The test_commands never import or run ${posix.basename(targetFilePath.replace(/\\/g, "/"))}, so passing them would prove nothing about the drafted file. ` +
        "Import or execute the new file and assert its behaviour."
    );
  }

  issues.push(...lintPattern(draft.expected_output_pattern));
  return issues;
}

/** Everything wrong with a draft: file problems first, then test problems. */
export function lintDraft(draft: LlmRemediationDraft, targetFilePath: string): string[] {
  const fileIssues = lintFile(draft, targetFilePath);
  // An empty file has no meaningful tests to judge; report it alone.
  return draft.full_file_content.trim().length === 0 ? fileIssues : [...fileIssues, ...lintTests(draft, targetFilePath)];
}

function lintPattern(pattern: string): string[] {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return [`expected_output_pattern is ${pattern.length} characters long (limit ${MAX_PATTERN_LENGTH}). Use a short, specific success marker such as VERIFIED.`];
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return [`expected_output_pattern "${truncate(pattern)}" is not a valid regular expression. Use a plain marker such as VERIFIED.`];
  }

  // A success marker has to require some text, so a pattern that matches empty
  // output (".*", "a*", "^", "$", ...) can pass on a run that printed nothing.
  // Probes are tiny, so evaluating an arbitrary pattern against them cannot blow up.
  if (compiled.test("") || PROBES.every((probe) => compiled.test(probe))) {
    return [
      `expected_output_pattern "${truncate(pattern)}" matches any output, so it proves nothing. ` +
        "Print a specific success marker (e.g. VERIFIED) only after your assertions pass, and match on that.",
    ];
  }
  return [];
}

/** True when the commands mention the drafted file, by its module name or its
 * file name, so they can plausibly import or run it. */
function testsExerciseFile(commands: string[], targetFilePath: string): boolean {
  const normalized = targetFilePath.replace(/\\/g, "/");
  const base = posix.basename(normalized);
  const stem = base.replace(/\.[^.]*$/, "");
  const parent = posix.basename(posix.dirname(normalized));

  const needles = [base, stem, ...(GENERIC_STEMS.has(stem) ? [parent] : [])].filter((needle) => needle.length > 0);
  const haystack = commands.join("\n").toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function truncate(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
