import { describe, expect, it, vi } from "vitest";
import { createSandbox } from "../../src/sandbox/createSandbox.js";
import type { CommandRunner } from "../../src/sandbox/commandRunner.js";

const baseConfig = { SANDBOX_TIMEOUT_SECONDS: 30, SANDBOX_LOCAL_ACKNOWLEDGE: false } as const;

function runnerReturning(exitCode: number): CommandRunner {
  return { run: vi.fn().mockResolvedValue({ exitCode, stdout: "27.0.1", stderr: "", timedOut: false, durationMs: 5 }) };
}

describe("createSandbox", () => {
  it("returns no runner when verification is switched off", async () => {
    const selection = await createSandbox({ ...baseConfig, SANDBOX_MODE: "off" }, runnerReturning(0));

    expect(selection.runner).toBeNull();
    expect(selection.mode).toBe("off");
    expect(selection.available).toBe(false);
  });

  it("refuses local mode unless the user has explicitly acknowledged the risk", async () => {
    await expect(createSandbox({ ...baseConfig, SANDBOX_MODE: "local" }, runnerReturning(0))).rejects.toThrow(
      /SANDBOX_LOCAL_ACKNOWLEDGE=true/
    );
  });

  it("builds the local runner once the risk is acknowledged, and says it is not isolated", async () => {
    const selection = await createSandbox(
      { ...baseConfig, SANDBOX_MODE: "local", SANDBOX_LOCAL_ACKNOWLEDGE: true },
      runnerReturning(0)
    );

    expect(selection.mode).toBe("local");
    expect(selection.runner?.mode).toBe("local");
    expect(selection.available).toBe(true);
    expect(selection.note).toMatch(/not isolated/i);
  });

  it("marks docker available when the daemon answers", async () => {
    const selection = await createSandbox({ ...baseConfig, SANDBOX_MODE: "docker" }, runnerReturning(0));

    expect(selection.mode).toBe("docker");
    expect(selection.available).toBe(true);
  });

  it("marks docker unavailable when the daemon does not answer", async () => {
    const selection = await createSandbox({ ...baseConfig, SANDBOX_MODE: "docker" }, runnerReturning(1));

    expect(selection.available).toBe(false);
    expect(selection.note).toMatch(/not available/i);
  });

  it("marks docker unavailable when the docker binary is missing", async () => {
    const missing: CommandRunner = { run: vi.fn().mockRejectedValue(new Error("spawn docker ENOENT")) };

    const selection = await createSandbox({ ...baseConfig, SANDBOX_MODE: "docker" }, missing);

    expect(selection.available).toBe(false);
    expect(selection.runner).not.toBeNull();
  });
});
