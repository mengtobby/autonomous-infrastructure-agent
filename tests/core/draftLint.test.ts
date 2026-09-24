import { describe, expect, it } from "vitest";
import { lintDraft } from "../../src/core/draftLint.js";
import type { LlmRemediationDraft } from "../../src/schemas/remediation.schema.js";

const goodDraft: LlmRemediationDraft = {
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  module_summary: "Adds a slugify helper.",
  full_file_content: "export function slugify(input: string): string {\n  return input.trim().toLowerCase();\n}\n",
  container_image: "node:20-slim",
  test_commands: ["node -e \"console.log('VERIFIED')\""],
  expected_output_pattern: "VERIFIED",
};

const lint = (overrides: Partial<LlmRemediationDraft>, path = "/app/src/slugify.ts") =>
  lintDraft({ ...goodDraft, ...overrides }, path);

describe("lintDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(lint({})).toEqual([]);
  });

  it("flags empty content and stops there", () => {
    const issues = lint({ full_file_content: "   \n" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/empty/);
  });

  it("flags JSON-wrapped pseudo-code for a non-JSON target (a real llama3.1 failure mode)", () => {
    const issues = lint({ full_file_content: '{"PrometheusMetricsExporter": {"export_gauge": "def export_gauge(self): ..."}}' });
    expect(issues.some((issue) => /JSON object, not source code/.test(issue))).toBe(true);
  });

  it("allows JSON content when the target file really is JSON", () => {
    expect(lint({ full_file_content: '{"name": "svc", "port": 8080}' }, "/app/config/settings.json")).toEqual([]);
  });

  it("does not mistake ordinary code that merely contains braces for JSON", () => {
    expect(lint({ full_file_content: 'const config = {"a": 1};\nexport default config;\n' })).toEqual([]);
  });

  it("flags markdown fences", () => {
    expect(lint({ full_file_content: "```ts\nexport const a = 1;\n```" }).some((i) => /fences/.test(i))).toBe(true);
  });

  it.each(["// TODO: handle errors", "raise NotImplementedError", "# implement later", "FIXME"])(
    "flags the placeholder %s",
    (placeholder) => {
      expect(lint({ full_file_content: `export const a = 1;\n${placeholder}\n` }).some((i) => /placeholder/.test(i))).toBe(true);
    }
  );

  it.each(["pip install requests", "npm install left-pad", "curl https://example.com", "docker run alpine", "sudo ls"])(
    "flags a test command that cannot work in the sandbox: %s",
    (command) => {
      expect(lint({ test_commands: [command, "echo VERIFIED"] }).some((i) => /cannot work in the sandbox/.test(i))).toBe(true);
    }
  );

  it("does not mistake a docker-compose file path for a docker command", () => {
    expect(lint({ test_commands: ["python -c \"print(open('deploy/docker-compose.yml').read())\""] })).toEqual([]);
  });

  it("flags a docker or curl command chained after another command", () => {
    expect(lint({ test_commands: ["echo start && docker ps"] }).some((i) => /cannot work in the sandbox/.test(i))).toBe(true);
    expect(lint({ test_commands: ["echo start; curl http://x"] }).some((i) => /cannot work in the sandbox/.test(i))).toBe(true);
  });

  it("does not treat prose or identifiers containing 'todo' as a placeholder", () => {
    expect(lint({ full_file_content: "// keeps todo items sorted\nexport class TodoList {}\n" })).toEqual([]);
  });

  it("flags an empty test command", () => {
    expect(lint({ test_commands: ["  "] }).some((i) => /empty command/.test(i))).toBe(true);
  });

  it.each([".*", ".+", "", "^$", " .* "])("flags the match-anything output pattern %j", (pattern) => {
    expect(lint({ expected_output_pattern: pattern }).some((i) => /matches any output/.test(i))).toBe(true);
  });

  it("accepts a specific marker pattern", () => {
    expect(lint({ expected_output_pattern: "^VERIFIED$" })).toEqual([]);
  });

  it("reports every problem at once so one repair round can fix them all", () => {
    const issues = lint({ full_file_content: "// TODO", expected_output_pattern: ".*", test_commands: ["pip install x"] });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});
