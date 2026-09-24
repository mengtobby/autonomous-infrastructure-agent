import { describe, expect, it } from "vitest";
import { DraftFormatError, parseDraft, renderDraft } from "../../src/llm/draftFormat.js";
import type { LlmRemediationDraft } from "../../src/schemas/remediation.schema.js";

const PYTHON = 'def label(value):\n    return "line one\\nline two: {}".format(value)\n';

const draft: LlmRemediationDraft = {
  root_cause_analysis: { error_type: "ModuleNotFoundError", failing_component: "/app/x.py", detailed_explanation: "The file is missing." },
  module_summary: "Adds a label helper.",
  full_file_content: PYTHON,
  container_image: "python:3.11-slim",
  test_commands: ["python -c \"from x import label; print('VERIFIED')\""],
  expected_output_pattern: "VERIFIED",
};

describe("renderDraft / parseDraft", () => {
  it("round-trips a draft exactly", () => {
    expect(parseDraft(renderDraft(draft))).toEqual(draft);
  });

  it("keeps escape sequences in code literally: backslash-n in a string stays backslash-n", () => {
    // The whole point of the format: nothing is escaped or unescaped on the way through.
    const parsed = parseDraft(renderDraft(draft));
    expect(parsed.full_file_content).toContain('"line one\\nline two: {}"');
    expect(parsed.full_file_content.split("\n").length).toBe(3);
  });

  it("keeps quotes, braces, backslashes and angle brackets in code untouched", () => {
    const tricky = 'x = "a\\tb"  # <b>bold</b> {"k": 1} \\\\ \'q\'\nif a < b and c > d:\n    pass\n';
    expect(parseDraft(renderDraft({ ...draft, full_file_content: tricky })).full_file_content).toBe(tricky);
  });

  it("preserves multiple test commands in order", () => {
    const commands = ["echo one", "echo two", "python -c \"print('VERIFIED')\""];
    expect(parseDraft(renderDraft({ ...draft, test_commands: commands })).test_commands).toEqual(commands);
  });
});

describe("parseDraft tolerance", () => {
  const body = renderDraft(draft);

  it("ignores prose before and after the tags", () => {
    expect(parseDraft(`Sure! Here is the fix:\n\n${body}\n\nLet me know if you need more.`)).toEqual(draft);
  });

  it("ignores a wrapping markdown fence around the whole reply", () => {
    expect(parseDraft("```xml\n" + body + "\n```")).toEqual(draft);
  });

  it("strips a code fence a model added inside <file> out of habit", () => {
    const fenced = body.replace("<file>\n", "<file>\n```python\n").replace("\n</file>", "\n```\n</file>");
    expect(parseDraft(fenced).full_file_content).toBe(PYTHON);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseDraft(body.replace(/\n/g, "\r\n")).full_file_content).toBe(PYTHON);
  });

  it("ends the file with exactly one newline whatever the model did", () => {
    expect(parseDraft(body.replace("</file>", "\n\n\n</file>")).full_file_content.endsWith("\n\n")).toBe(false);
    expect(parseDraft(body.replace("</file>", "\n\n\n</file>")).full_file_content.endsWith("\n")).toBe(true);
  });

  it("is not cut short by a literal </file> inside the code", () => {
    const code = 'MARKER = "</file>"\nprint(MARKER)\n';
    expect(parseDraft(renderDraft({ ...draft, full_file_content: code })).full_file_content).toBe(code);
  });

  it("trims whitespace around scalar fields", () => {
    const padded = body.replace("<container_image>python:3.11-slim", "<container_image>\n  python:3.11-slim\n  ");
    expect(parseDraft(padded).container_image).toBe("python:3.11-slim");
  });
});

describe("parseDraft errors", () => {
  const body = renderDraft(draft);

  it("names every missing tag at once so a retry can fix them together", () => {
    const stripped = body.replace(/<file>[\s\S]*<\/file>/, "").replace(/<container_image>.*<\/container_image>/, "");
    expect(() => parseDraft(stripped)).toThrowError(DraftFormatError);
    expect(() => parseDraft(stripped)).toThrow(/<file>.*<container_image>|<container_image>.*<file>/);
  });

  it("rejects an empty file", () => {
    expect(() => parseDraft(body.replace(PYTHON.trimEnd(), ""))).toThrow(/<file>/);
  });

  it("rejects a reply with no test commands", () => {
    expect(() => parseDraft(body.replace(/<test_command>[\s\S]*?<\/test_command>/, ""))).toThrow(/<test_command>/);
  });

  it("rejects a reply that is just prose", () => {
    expect(() => parseDraft("I cannot help with that.")).toThrowError(DraftFormatError);
  });

  it("rejects an unterminated <file> block", () => {
    expect(() => parseDraft(body.replace("</file>", ""))).toThrow(/<file>/);
  });

  it("rejects a reply the model gave as JSON, telling it what is missing", () => {
    expect(() => parseDraft(JSON.stringify(draft))).toThrow(/missing required tags/);
  });
});
