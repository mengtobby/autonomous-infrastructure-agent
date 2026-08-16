import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxWorkspace, toContainerRelativePath } from "../../src/sandbox/workspaceBuilder.js";

describe("toContainerRelativePath", () => {
  it("strips a known /app/ root", () => {
    expect(toContainerRelativePath("/app/collectors/metrics_exporter.py")).toBe("collectors/metrics_exporter.py");
  });

  it("normalizes Windows-style separators", () => {
    expect(toContainerRelativePath("/app/collectors\\metrics_exporter.py")).toBe("collectors/metrics_exporter.py");
  });

  it("strips a bare drive letter root when no known app root matches", () => {
    expect(toContainerRelativePath("C:/service/handlers/index.js")).toBe("service/handlers/index.js");
  });
});

describe("buildSandboxWorkspace", () => {
  it("writes the file content at the expected relative path and cleans up after", async () => {
    const workspace = await buildSandboxWorkspace("/app/collectors/metrics_exporter.py", "print('hi')\n");

    expect(workspace.relativeFilePath).toBe("collectors/metrics_exporter.py");

    const writtenPath = join(workspace.workspaceDir, "collectors", "metrics_exporter.py");
    const content = await readFile(writtenPath, "utf8");
    expect(content).toBe("print('hi')\n");

    await workspace.cleanup();
    await expect(stat(workspace.workspaceDir)).rejects.toThrow();
  });
});
