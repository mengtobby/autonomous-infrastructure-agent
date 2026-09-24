import { describe, expect, it, vi } from "vitest";
import { DockerSandboxRunner } from "../../src/sandbox/dockerSandboxRunner.js";
import type { CommandResult, CommandRunner } from "../../src/sandbox/commandRunner.js";
import type { SandboxJob } from "../../src/sandbox/sandboxRunner.js";

const baseJob: SandboxJob = {
  targetFilePath: "/app/collectors/metrics_exporter.py",
  fileContent: "print('hi')\n",
  containerImage: "python:3.11-slim",
  testCommands: ["python -c \"print('hi')\"", "echo VERIFIED"],
  expectedOutputPattern: "VERIFIED",
  resourceLimits: { cpu_limit: "0.5", memory_limit: "256m" },
};

const okResult: CommandResult = { exitCode: 0, stdout: "hi\nVERIFIED\n", stderr: "", timedOut: false, durationMs: 42 };

function fakeCommandRunner(result: CommandResult): CommandRunner {
  return { run: vi.fn().mockResolvedValue(result) };
}

describe("DockerSandboxRunner", () => {
  it("reports passed=true when exit code is 0 and output matches the pattern", async () => {
    const commandRunner = fakeCommandRunner(okResult);
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run(baseJob);

    expect(result.passed).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(commandRunner.run).toHaveBeenCalledTimes(1);
    const [command, args] = (commandRunner.run as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(command).toBe("docker");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain(baseJob.containerImage);
  });

  it("reports passed=false when the expected pattern is absent even with exit code 0", async () => {
    const runner = new DockerSandboxRunner({
      commandRunner: fakeCommandRunner({ ...okResult, stdout: "hi\n" }),
      timeoutSeconds: 30,
    });

    expect((await runner.run(baseJob)).passed).toBe(false);
  });

  it("reports passed=false and timed_out=true when the run times out", async () => {
    const runner = new DockerSandboxRunner({
      commandRunner: fakeCommandRunner({ exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs: 30000 }),
      timeoutSeconds: 30,
    });

    const result = await runner.run(baseJob);

    expect(result.passed).toBe(false);
    expect(result.timed_out).toBe(true);
  });

  it("kills the named container by name after a timeout, since SIGKILL-ing the CLI doesn't stop it", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: null, stdout: "", stderr: "", timedOut: true, durationMs: 30000 });
    const runner = new DockerSandboxRunner({ commandRunner: { run }, timeoutSeconds: 30 });

    await runner.run(baseJob);

    expect(run).toHaveBeenCalledTimes(2);
    const [, firstArgs] = run.mock.calls[0] as [string, string[], number];
    const [secondCommand, secondArgs] = run.mock.calls[1] as [string, string[], number];
    const containerName = firstArgs[firstArgs.indexOf("--name") + 1];

    expect(secondCommand).toBe("docker");
    expect(secondArgs).toEqual(["kill", containerName]);
  });

  it("does not attempt to kill a container when the run completes normally", async () => {
    const commandRunner = fakeCommandRunner(okResult);
    await new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 }).run(baseJob);

    expect(commandRunner.run).toHaveBeenCalledTimes(1);
  });

  it("never invokes docker when there are no test commands", async () => {
    const commandRunner = fakeCommandRunner(okResult);
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run({ ...baseJob, testCommands: [] });

    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
  });

  it("refuses a container image that is not on the allowlist, without spawning docker", async () => {
    const commandRunner = fakeCommandRunner(okResult);
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run({ ...baseJob, containerImage: "evil.registry.io/attacker/miner:latest" });

    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
    expect(result.stderr).toMatch(/refused the container image/i);
    expect(result.error).toBeUndefined();
  });

  it("refuses an image name that would be parsed by docker as a flag", async () => {
    const commandRunner = fakeCommandRunner(okResult);
    const runner = new DockerSandboxRunner({ commandRunner, timeoutSeconds: 30 });

    const result = await runner.run({ ...baseJob, containerImage: "--privileged" });

    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
  });

  it("reports an environment error, not a failed draft, when docker cannot be spawned", async () => {
    const run = vi.fn().mockRejectedValue(new Error("spawn docker ENOENT"));
    const runner = new DockerSandboxRunner({ commandRunner: { run }, timeoutSeconds: 30 });

    const result = await runner.run(baseJob);

    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/Docker is not available/);
  });
});
