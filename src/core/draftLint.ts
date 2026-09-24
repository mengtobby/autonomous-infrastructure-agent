import type { LlmRemediationDraft } from "../schemas/remediation.schema.js";

const JSON_FILE = /\.(json|jsonc|json5)$/i;
/** TODO/FIXME are matched case-sensitively so prose like "todo items" or an
 * identifier like TodoList isn't mistaken for an unfinished stub. */
const PLACEHOLDER_MARKER = /\b(?:TODO|FIXME)\b/;
const PLACEHOLDER_PHRASE = /NotImplemented(?:Error)?\b|implement (?:me|later)|your code here/i;
const MARKDOWN_FENCE = /^\s*```/m;
const JSON_OBJECT_START = /^\{\s*"[^"\n]+"\s*:/;

/** Commands that need network or the host — pointless (and misleading) in a
 * sandbox that has no network and no Docker socket. Program names are only
 * matched in command position, so a path like "docker-compose.yml" or an
 * argument that merely mentions curl does not trigger it. */
const UNAVAILABLE_COMMAND =
  /(?:^|[;&|]\s*)(?:sudo|docker|curl|wget)\s|\b(?:pip3?\s+install|npm\s+(?:install|i|ci)|yarn\s+add|apt(?:-get)?\s+install|apk\s+add|git\s+clone)\b/i;

/** Patterns that match any output, so "passing" would only prove exit code 0. */
const MATCH_ANYTHING = new Set(["", ".", ".*", ".+", ".*?", "^.*$", "^.+$", "^$", "(?s).*"]);

/**
 * Deterministic, free checks on a draft before anything is executed. Each
 * message is phrased as an instruction to the model, because it is fed back
 * verbatim if the draft has to be repaired.
 */
export function lintDraft(draft: LlmRemediationDraft, targetFilePath: string): string[] {
  const issues: string[] = [];
  const content = draft.full_file_content;
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    issues.push("full_file_content is empty. Provide the complete source code of the file.");
    return issues;
  }

  if (!JSON_FILE.test(targetFilePath) && JSON_OBJECT_START.test(trimmed)) {
    issues.push(
      `full_file_content is a JSON object, not source code. It must be the raw text of ${targetFilePath} itself, ` +
        "not JSON that describes the code."
    );
  }

  if (MARKDOWN_FENCE.test(content)) {
    issues.push("full_file_content contains markdown code fences (```). Return the raw file text with no fences.");
  }

  if (PLACEHOLDER_MARKER.test(content) || PLACEHOLDER_PHRASE.test(content)) {
    issues.push("full_file_content contains a placeholder (TODO / NotImplemented / 'implement later'). Implement everything fully.");
  }

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

  if (MATCH_ANYTHING.has(draft.expected_output_pattern.trim())) {
    issues.push(
      `expected_output_pattern "${draft.expected_output_pattern}" matches any output, so it proves nothing. ` +
        "Print a specific success marker (e.g. VERIFIED) only after your assertions pass, and match on that."
    );
  }

  return issues;
}
