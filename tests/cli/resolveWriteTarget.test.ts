import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { resolveWriteTarget } from "../../src/cli/resolveWriteTarget.js";

const projectRoot = resolve("C:\\Users\\dev\\autonomous-infra-agent");

describe("resolveWriteTarget", () => {
  it("resolves a conventional /app/-style path under the project root", () => {
    const result = resolveWriteTarget(projectRoot, "/app/collectors/metrics_exporter.py");
    expect(result.withinProjectRoot).toBe(true);
    expect(result.path).toBe(resolve(projectRoot, "app/collectors/metrics_exporter.py"));
  });

  it("resolves a plain relative path under the project root", () => {
    const result = resolveWriteTarget(projectRoot, "src/utils/slugify.ts");
    expect(result.withinProjectRoot).toBe(true);
    expect(result.path).toBe(resolve(projectRoot, "src/utils/slugify.ts"));
  });

  it("strips a Windows drive letter instead of treating it as an escape-worthy absolute path", () => {
    const result = resolveWriteTarget(projectRoot, "C:\\Users\\someone\\Documents\\important.py");
    expect(result.withinProjectRoot).toBe(true);
    expect(result.path).toBe(resolve(projectRoot, "Users/someone/Documents/important.py"));
  });

  it("never escapes the project root even with traversal segments", () => {
    const result = resolveWriteTarget(projectRoot, "/app/../../../etc/passwd");
    expect(result.withinProjectRoot).toBe(false);
  });

  it("flags a bare drive letter with no remaining path as outside the root only if it escapes", () => {
    const result = resolveWriteTarget(projectRoot, "D:\\other-drive\\file.py");
    expect(result.withinProjectRoot).toBe(true);
    expect(result.path).toBe(resolve(projectRoot, "other-drive/file.py"));
  });
});
