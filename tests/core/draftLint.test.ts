import { describe, expect, it } from "vitest";
import { lintDraft, lintFile, lintTests } from "../../src/core/draftLint.js";
import type { LlmRemediationDraft } from "../../src/schemas/remediation.schema.js";

const goodDraft: LlmRemediationDraft = {
  root_cause_analysis: { error_type: "e", failing_component: "f", detailed_explanation: "d" },
  module_summary: "Adds a slugify helper.",
  full_file_content: "export function slugify(input: string): string {\n  return input.trim().toLowerCase();\n}\n",
  container_image: "node:20-slim",
  test_commands: ["node -e \"const { slugify } = require('./src/slugify'); console.log('VERIFIED')\""],
  expected_output_pattern: "VERIFIED",
};

const PATH = "/app/src/slugify.ts";
const lint = (overrides: Partial<LlmRemediationDraft>, path = PATH) => lintDraft({ ...goodDraft, ...overrides }, path);
const has = (issues: string[], pattern: RegExp) => issues.some((issue) => pattern.test(issue));

describe("lintDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(lint({})).toEqual([]);
  });

  it("flags empty content and stops there", () => {
    const issues = lint({ full_file_content: "   \n" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/empty/);
  });

  it("is the union of the file checks and the test checks", () => {
    const draft = { ...goodDraft, full_file_content: "// TODO", expected_output_pattern: ".*" };
    expect(lintDraft(draft, PATH)).toEqual([...lintFile(draft, PATH), ...lintTests(draft, PATH)]);
  });

  it("reports every problem at once so one repair round can fix them all", () => {
    expect(lint({ full_file_content: "// TODO", expected_output_pattern: ".*", test_commands: ["pip install x"] }).length).toBeGreaterThanOrEqual(3);
  });
});

describe("lintFile", () => {
  const file = (content: string, path = PATH) => lintFile({ ...goodDraft, full_file_content: content }, path);

  it("flags JSON-wrapped pseudo-code for a non-JSON target (a real llama3.1 failure mode)", () => {
    expect(has(file('{"PrometheusMetricsExporter": {"export_gauge": "def export_gauge(self): ..."}}'), /JSON object, not source code/)).toBe(true);
  });

  it("allows JSON content when the target file really is JSON", () => {
    expect(file('{"name": "svc", "port": 8080}', "/app/config/settings.json")).toEqual([]);
  });

  it("does not mistake ordinary code that merely contains braces for JSON", () => {
    expect(file('const config = {"a": 1};\nexport default config;\n')).toEqual([]);
  });

  it("flags markdown fences in code", () => {
    expect(has(file("```ts\nexport const a = 1;\n```"), /fences/)).toBe(true);
  });

  it("allows fenced blocks in a markdown target, where they are legitimate content", () => {
    expect(file("# Usage\n\n```bash\nnpm start\n```\n", "/app/docs/USAGE.md")).toEqual([]);
  });

  it.each(["// TODO: handle errors", "raise NotImplementedError", "raise NotImplemented", "# implement later", "FIXME"])(
    "flags the placeholder %s",
    (placeholder) => {
      expect(has(file(`export const a = 1;\n${placeholder}\n`), /placeholder/)).toBe(true);
    }
  );

  it("does not flag Python's legitimate `return NotImplemented` (the binary-operator protocol)", () => {
    expect(file("class V:\n    def __add__(self, other):\n        return NotImplemented\n", "/app/v.py")).toEqual([]);
  });

  it("does not treat prose or identifiers containing 'todo' as a placeholder", () => {
    expect(file("// keeps todo items sorted\nexport class TodoList {}\n")).toEqual([]);
  });
});

describe("lintTests", () => {
  const tests = (overrides: Partial<LlmRemediationDraft>, path = PATH) => lintTests({ ...goodDraft, ...overrides }, path);

  describe("the tests must exercise the drafted file", () => {
    it("REGRESSION: rejects tests that never touch the file (a self-graded pass such as `echo VERIFIED`)", () => {
      const issues = tests({ test_commands: ["echo VERIFIED"] });
      expect(has(issues, /never import or run slugify\.ts/)).toBe(true);
    });

    it("accepts a test that imports the module by name", () => {
      expect(tests({ test_commands: ["python -c \"from collectors.metrics_exporter import P; print('VERIFIED')\""] }, "/app/collectors/metrics_exporter.py")).toEqual([]);
    });

    it("accepts a test that names the file itself", () => {
      expect(tests({ test_commands: ["node --check src/slugify.ts", "echo VERIFIED"] })).toEqual([]);
    });

    it("recognises a compose file by its name, hyphen and all", () => {
      expect(
        tests({ test_commands: ["python -c \"print(open('deploy/docker-compose.yml').read()); print('VERIFIED')\""] }, "/app/deploy/docker-compose.yml")
      ).toEqual([]);
    });

    it("names a generic file like __init__.py by its package directory", () => {
      const path = "/app/ratelimit/__init__.py";
      expect(tests({ test_commands: ["python -c \"import ratelimit; print('VERIFIED')\""] }, path)).toEqual([]);
      expect(has(tests({ test_commands: ["echo VERIFIED"] }, path), /never import or run/)).toBe(true);
    });

    it("compares case-insensitively and across Windows-style target paths", () => {
      expect(tests({ test_commands: ['python -c "import METRICS_EXPORTER; print(1)"'] }, "C:\\app\\collectors\\metrics_exporter.py")).toEqual([]);
    });
  });

  describe("commands that cannot work in the sandbox", () => {
    it.each(["pip install requests", "npm install left-pad", "curl https://example.com", "docker run alpine", "sudo ls"])("flags %s", (command) => {
      expect(has(tests({ test_commands: [command, "echo slugify VERIFIED"] }), /cannot work in the sandbox/)).toBe(true);
    });

    it("does not mistake a docker-compose file path for a docker command", () => {
      expect(tests({ test_commands: ["python -c \"print(open('deploy/docker-compose.yml').read())\""] }, "/app/deploy/docker-compose.yml")).toEqual([]);
    });

    it("flags a docker or curl command chained after another command", () => {
      expect(has(tests({ test_commands: ["echo slugify && docker ps"] }), /cannot work in the sandbox/)).toBe(true);
      expect(has(tests({ test_commands: ["echo slugify; curl http://x"] }), /cannot work in the sandbox/)).toBe(true);
    });

    it("flags an empty test command", () => {
      expect(has(tests({ test_commands: ["  ", "echo slugify"] }), /empty command/)).toBe(true);
    });
  });

  describe("portable quoting", () => {
    it.each(["python -c 'print(1)'", "node -e 'console.log(1)'", "python3 -c 'import slugify'"])("flags the single-quoted program %s", (command) => {
      expect(has(tests({ test_commands: [`${command} # slugify`] }), /single quotes.*fails on Windows/)).toBe(true);
    });

    it("allows single quotes inside a double-quoted program", () => {
      expect(tests({ test_commands: ["python -c \"import slugify; print('VERIFIED')\""] })).toEqual([]);
    });
  });

  describe("hidden output", () => {
    it.each(["python -c \"import slugify\" 2>/dev/null", "node -e \"require('./slugify')\" >/dev/null 2>&1", "python -c \"import slugify\" 2> /dev/null"])(
      "flags a redirect that throws the output away: %s",
      (command) => {
        expect(has(tests({ test_commands: [command] }), /hides the output/)).toBe(true);
      }
    );

    it("does not flag a command that merely mentions a path containing 'null'", () => {
      expect(has(tests({ test_commands: ["python -c \"import slugify; print('nullable')\""] }), /hides the output/)).toBe(false);
    });
  });

  describe("the success marker", () => {
    it.each([".*", ".+", "", "^$", "a*", "\\s*", "[\\s\\S]*", "[\\s\\S]+", "^", "$", "(?:)", ".{0,}", "\\S"])(
      "flags the match-anything pattern %j",
      (pattern) => {
        expect(has(tests({ expected_output_pattern: pattern }), /matches any output/)).toBe(true);
      }
    );

    it.each(["VERIFIED", "^VERIFIED$", "ok\\s+42", "\\bPASS(ED)?\\b", "All \\d+ checks passed"])("accepts the specific marker %j", (pattern) => {
      expect(tests({ expected_output_pattern: pattern })).toEqual([]);
    });

    it.each(["([unclosed", "(?s).*", "*abc"])("flags %j: not a valid JavaScript regular expression", (pattern) => {
      expect(has(tests({ expected_output_pattern: pattern }), /not a valid regular expression/)).toBe(true);
    });

    it("flags an over-long pattern instead of evaluating it", () => {
      expect(has(tests({ expected_output_pattern: `${"a".repeat(400)}b` }), /limit 300/)).toBe(true);
    });

    it("does not hang on a catastrophic-backtracking pattern (only tiny probes are ever evaluated)", () => {
      const started = Date.now();
      tests({ expected_output_pattern: "^(a+)+$" });
      expect(Date.now() - started).toBeLessThan(500);
    });
  });
});
