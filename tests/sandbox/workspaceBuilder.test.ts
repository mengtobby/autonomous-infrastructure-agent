import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxWorkspace, InvalidTargetPathError, toContainerRelativePath } from "../../src/sandbox/workspaceBuilder.js";

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

const leftoverSandboxes = async (): Promise<string[]> => (await readdir(tmpdir())).filter((name) => name.startsWith("infra-agent-sandbox-"));

describe("buildSandboxWorkspace", () => {
  it("writes the file content at the expected relative path and cleans up after", async () => {
    const workspace = await buildSandboxWorkspace("/app/collectors/metrics_exporter.py", "print('hi')\n");

    expect(workspace.relativeFilePath).toBe("collectors/metrics_exporter.py");
    expect(await readFile(join(workspace.workspaceDir, "collectors", "metrics_exporter.py"), "utf8")).toBe("print('hi')\n");

    await workspace.cleanup();
    await expect(stat(workspace.workspaceDir)).rejects.toThrow();
  });

  describe("REGRESSION: paths that cannot be written never leave a temp directory behind", () => {
    it.each([
      ["a directory, not a file", "/app/"],
      ["a bare app root", "/workspace/"],
      ["a NUL character", "/app/x\0y.py"],
      ["an escape from the workspace", "../../etc/passwd"],
      ["the workspace itself", "."],
    ])("rejects %s", async (_label, target) => {
      const before = await leftoverSandboxes();

      await expect(buildSandboxWorkspace(target, "x")).rejects.toThrow(InvalidTargetPathError);

      expect(await leftoverSandboxes()).toEqual(before);
    });
  });
});
