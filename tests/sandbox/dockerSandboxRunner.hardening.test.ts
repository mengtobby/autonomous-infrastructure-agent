import { describe, expect, it, vi } from "vitest";
import { DockerSandboxRunner } from "../../src/sandbox/dockerSandboxRunner.js";
import type { CommandResult } from "../../src/sandbox/commandRunner.js";
import type { SandboxJob } from "../../src/sandbox/sandboxRunner.js";

const job: SandboxJob = {
  targetFilePath: "/app/collectors/metrics_exporter.py",
  fileContent: "print('hi')\n",
  containerImage: "python:3.11-slim",
  testCommands: ['echo VERIFIED # smoke', 'python -c "import collectors.metrics_exporter"'],
  expectedOutputPattern: "VERIFIED",
  resourceLimits: { cpu_limit: "0.5", memory_limit: "256m" },
};

const okResult: CommandResult = { exitCode: 0, stdout: "VERIFIED\n", stderr: "", timedOut: false, durationMs: 5 };

async function dockerArgsFor(overrides: Partial<SandboxJob> = {}, result: CommandResult = okResult): Promise<string[]> {
  const run = vi.fn().mockResolvedValue(result);
  await new DockerSandboxRunner({ commandRunner: { run }, timeoutSeconds: 30 }).run({ ...job, ...overrides });
  return run.mock.calls[0]?.[1] as string[];
}

const pairAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

describe("DockerSandboxRunner hardening", () => {
  it("drops every capability, forbids privilege escalation and makes the root filesystem read-only", async () => {
    const args = await dockerArgsFor();

    expect(pairAfter(args, "--cap-drop")).toBe("ALL");
    expect(pairAfter(args, "--security-opt")).toBe("no-new-privileges");
    expect(args).toContain("--read-only");
    expect(pairAfter(args, "--tmpfs")).toMatch(/^\/tmp:rw,size=\d+m$/);
  });

  it("keeps the network off and the workspace mount read-only", async () => {
    const args = await dockerArgsFor();

    expect(pairAfter(args, "--network")).toBe("none");
    expect(pairAfter(args, "-v")).toMatch(/:\/workspace:ro$/);
  });

  it("gives Python and Node the same module path as the local sandbox, and stops Python writing bytecode", async () => {
    const args = await dockerArgsFor();
    const env = args.filter((_, index) => args[index - 1] === "-e");

    expect(env).toEqual(expect.arrayContaining(["PYTHONPATH=/workspace", "NODE_PATH=/workspace", "PYTHONDONTWRITEBYTECODE=1"]));
  });

  it("REGRESSION: passes docker the same trimmed image string that was validated", async () => {
    const args = await dockerArgsFor({ containerImage: "  python:3.11-slim \n" });

    expect(args).toContain("python:3.11-slim");
    expect(args.some((arg) => arg !== arg.trim() && arg.includes("python"))).toBe(false);
  });

  it("REGRESSION: puts each test command on its own line so a # comment cannot swallow the next one", async () => {
    const args = await dockerArgsFor();
    const script = args[args.length - 1] as string;

    expect(script.split("\n")).toEqual(["set -e", 'echo VERIFIED # smoke', 'python -c "import collectors.metrics_exporter"']);
    expect(script).not.toContain(" && ");
  });

  it("REGRESSION: scrubs the host's temp workspace path from output returned to callers", async () => {
    const run = vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      const mount = args[args.indexOf("-v") + 1] as string;
      const workspace = mount.replace(/:\/workspace:ro$/, "");
      return { ...okResult, stderr: `Traceback: File "${workspace}/collectors/metrics_exporter.py"` };
    });

    const result = await new DockerSandboxRunner({ commandRunner: { run }, timeoutSeconds: 30 }).run(job);

    expect(result.stderr).toBe('Traceback: File "<sandbox>/collectors/metrics_exporter.py"');
  });

  it("reports an unusable target path as an environment problem, not a failed draft, and never spawns docker", async () => {
    const run = vi.fn().mockResolvedValue(okResult);

    const result = await new DockerSandboxRunner({ commandRunner: { run }, timeoutSeconds: 30 }).run({ ...job, targetFilePath: "/app/" });

    expect(run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/Could not prepare the sandbox workspace/);
  });
});
