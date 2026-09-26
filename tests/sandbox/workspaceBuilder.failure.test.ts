import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

// A real failure *after* the temp directory exists: the disk fills while writing the file.
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  writeFile: vi.fn().mockRejectedValue(new Error("ENOSPC: no space left on device")),
}));

const { buildSandboxWorkspace } = await import("../../src/sandbox/workspaceBuilder.js");

const leftoverSandboxes = async (): Promise<string[]> => (await readdir(tmpdir())).filter((name) => name.startsWith("infra-agent-sandbox-"));

describe("buildSandboxWorkspace when writing fails part-way", () => {
  it("REGRESSION: removes the directory it already created and rethrows the real error", async () => {
    const before = await leftoverSandboxes();

    await expect(buildSandboxWorkspace("/app/x.py", "content")).rejects.toThrow(/ENOSPC/);

    expect(await leftoverSandboxes()).toEqual(before);
  });
});
