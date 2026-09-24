import { llmRemediationDraftSchema, type LlmRemediationDraft } from "../schemas/remediation.schema.js";

/**
 * The reply format models are asked for. Source code is NOT put inside a JSON
 * string: doing that forces the model to reason about two escaping layers at
 * once (`\n` versus `\\n`), which small local models get wrong in both
 * directions (literal "\n" sequences in the code, or real newlines inside a
 * quoted string). Here the file is raw text between tags, exactly as it
 * should appear on disk, so there is nothing to escape.
 */
export class DraftFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftFormatError";
  }
}

/** The tagged form of a draft: used for the prompt's example and to show the
 * model its own previous answer when asking for a repair. */
export function renderDraft(draft: LlmRemediationDraft): string {
  const commands = draft.test_commands.map((command) => `<test_command>${command}</test_command>`).join("\n");
  return [
    "<root_cause_analysis>",
    `<error_type>${draft.root_cause_analysis.error_type}</error_type>`,
    `<failing_component>${draft.root_cause_analysis.failing_component}</failing_component>`,
    `<detailed_explanation>${draft.root_cause_analysis.detailed_explanation}</detailed_explanation>`,
    "</root_cause_analysis>",
    `<module_summary>${draft.module_summary}</module_summary>`,
    `<container_image>${draft.container_image}</container_image>`,
    "<file>",
    draft.full_file_content.replace(/\n$/, ""),
    "</file>",
    commands,
    `<expected_output_pattern>${draft.expected_output_pattern}</expected_output_pattern>`,
  ].join("\n");
}

/** Parses a model reply. Tolerant of surrounding prose and wrapping fences,
 * strict about the pieces that matter; the error names what is missing. */
export function parseDraft(reply: string): LlmRemediationDraft {
  const missing: string[] = [];
  const scalar = (tag: string): string => {
    const value = firstTag(reply, tag);
    if (value === null || value.trim() === "") {
      missing.push(`<${tag}>`);
      return "";
    }
    return value.trim();
  };

  const fileText = fileContents(reply);
  if (fileText === null || fileText.trim() === "") {
    missing.push("<file>");
  }

  const commands = [...reply.matchAll(/<test_command>([\s\S]*?)<\/test_command>/g)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
  if (commands.length === 0) {
    missing.push("<test_command>");
  }

  const candidate = {
    root_cause_analysis: {
      error_type: scalar("error_type"),
      failing_component: scalar("failing_component"),
      detailed_explanation: scalar("detailed_explanation"),
    },
    module_summary: scalar("module_summary"),
    full_file_content: fileText ?? "",
    container_image: scalar("container_image"),
    test_commands: commands,
    expected_output_pattern: scalar("expected_output_pattern"),
  };

  if (missing.length > 0) {
    throw new DraftFormatError(`The reply is missing required tags: ${[...new Set(missing)].join(", ")}.`);
  }

  const parsed = llmRemediationDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new DraftFormatError(`The reply did not form a valid draft: ${parsed.error.message}`);
  }
  return parsed.data;
}

function firstTag(text: string, tag: string): string | null {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null;
}

/** The file runs from the first <file> to the LAST </file>, so a literal
 * "</file>" inside the code (rare, but possible) does not cut it short. */
function fileContents(reply: string): string | null {
  const start = reply.indexOf("<file>");
  const end = reply.lastIndexOf("</file>");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return normalizeFile(reply.slice(start + "<file>".length, end));
}

/** Strips the newline after <file>, a code fence a model added out of habit,
 * and ensures a single trailing newline. */
function normalizeFile(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n+$/, "").split("\n");
  if (lines[0] !== undefined && /^```[\w+-]*\s*$/.test(lines[0])) lines.shift();
  if (lines.length > 0 && /^```\s*$/.test(lines[lines.length - 1] ?? "")) lines.pop();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
