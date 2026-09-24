import { describe, expect, it, vi } from "vitest";
import { LocalSandboxRunner } from "../../src/sandbox/localSandboxRunner.js";
import { ProcessCommandRunner } from "../../src/sandbox/processCommandRunner.js";
import type { CommandRunner } from "../../src/sandbox/commandRunner.js";
import type { SandboxJob } from "../../src/sandbox/sandboxRunner.js";

const job: SandboxJob = {
  targetFilePath: "/app/util/hello.js",
  fileContent: 'module.exports = () => "hello from the sandbox";\n',
  containerImage: "node:20-slim",
  testCommands: ["node -e \"console.log(require('./util/hello.js')())\""],
  expectedOutputPattern: "hello from the sandbox",
  resourceLimits: { cpu_limit: "0.5", memory_limit: "256m" },
};

describe("LocalSandboxRunner (real processes)", () => {
  const runner = new LocalSandboxRunner({ commandRunner: new ProcessCommandRunner(), timeoutSeconds: 20 });

  it("runs the drafted file and passes when the output matches", async () => {
    const result = await runner.run(job);

    expect(result.stderr).toBe("");
    expect(result.passed).toBe(true);
    expect(result.exit_code).toBe(0);
  });

  it("fails the run when the drafted code is wrong", async () => {
    const result = await runner.run({ ...job, fileContent: 'module.exports = () => "something else";\n' });

    expect(result.passed).toBe(false);
  });

  it("fails the run when the code throws", async () => {
    const result = await runner.run({ ...job, fileContent: 'throw new Error("boom");\n' });

    expect(result.passed).toBe(false);
    expect(result.exit_code).not.toBe(0);
    expect(result.stderr).toMatch(/boom/);
  });

  it("does not leak parent environment secrets into the drafted program", async () => {
    process.env.SANDBOX_LEAK_PROBE = "top-secret-value";
    const result = await runner.run({
      ...job,
      testCommands: ['node -e "console.log(process.env.SANDBOX_LEAK_PROBE || \'no-secret-visible\')"'],
      expectedOutputPattern: "no-secret-visible",
    });
    delete process.env.SANDBOX_LEAK_PROBE;

    expect(result.passed).toBe(true);
    expect(result.stdout).not.toContain("top-secret-value");
  });

  it("kills a hanging program at the timeout", async () => {
    const shortRunner = new LocalSandboxRunner({ commandRunner: new ProcessCommandRunner(), timeoutSeconds: 0.5 });

    const result = await shortRunner.run({
      ...job,
      testCommands: ['node -e "setTimeout(() => {}, 60000)"'],
    });

    expect(result.timed_out).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("writes the file at its container-relative path inside a throwaway directory", async () => {
    const result = await runner.run({
      ...job,
      testCommands: ['node -e "console.log(process.cwd())"'],
      expectedOutputPattern: "infra-agent-sandbox-",
    });

    expect(result.passed).toBe(true);
  });
});

describe("LocalSandboxRunner (fake command runner)", () => {
  it("never runs anything when there are no test commands", async () => {
    const commandRunner: CommandRunner = { run: vi.fn() };
    const runner = new LocalSandboxRunner({ commandRunner, timeoutSeconds: 5 });

    const result = await runner.run({ ...job, testCommands: [] });

    expect(commandRunner.run).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
  });

  it("chains test commands with && and runs them through a shell with a scrubbed environment", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 1 });
    const runner = new LocalSandboxRunner({ commandRunner: { run }, timeoutSeconds: 5 });

    await runner.run({ ...job, testCommands: ["echo one", "echo two"], expectedOutputPattern: "ok" });

    const [command, args, , options] = run.mock.calls[0] as [string, string[], number, { shell: boolean; env: Record<string, string> }];
    expect(command).toBe("echo one && echo two");
    expect(args).toEqual([]);
    expect(options.shell).toBe(true);
    expect(Object.keys(options.env)).toEqual(expect.arrayContaining(["PYTHONPATH"]));
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("reports an environment error when the process cannot be started", async () => {
    const run = vi.fn().mockRejectedValue(new Error("spawn failed"));
    const runner = new LocalSandboxRunner({ commandRunner: { run }, timeoutSeconds: 5 });

    const result = await runner.run(job);

    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/failed to start/i);
  });
});
