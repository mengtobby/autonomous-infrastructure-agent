import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProcessCommandRunner } from "../../src/sandbox/processCommandRunner.js";

const runner = new ProcessCommandRunner();
const node = process.execPath;

describe("ProcessCommandRunner", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const result = await runner.run(node, ["-e", "console.log('out'); console.error('err'); process.exit(3)"], 10_000);

    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it("kills a runaway process at the timeout and reports it", async () => {
    const startedAt = Date.now();
    const result = await runner.run(node, ["-e", "setTimeout(() => {}, 60000)"], 400);

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("kills the whole process tree when running through a shell", async () => {
    const startedAt = Date.now();
    const result = await runner.run(`"${node}" -e "setTimeout(() => {}, 60000)"`, [], 400, { shell: true });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("really terminates the grandchild process, not just the shell", async () => {
    const markerDir = await mkdtemp(join(tmpdir(), "tree-kill-"));
    const marker = join(markerDir, "survivor.txt").replace(/\\/g, "/");
    const script = `setTimeout(() => require('fs').writeFileSync('${marker}', 'alive'), 1500)`;

    const result = await runner.run(`"${node}" -e "${script}"`, [], 300, { shell: true });
    expect(result.timedOut).toBe(true);

    // If the workload survived, it writes the marker ~1.5s after start.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const survived = await stat(marker).then(
      () => true,
      () => false
    );
    await rm(markerDir, { recursive: true, force: true });

    expect(survived).toBe(false);
  });

  it("caps captured output so a chatty process cannot exhaust memory", async () => {
    const result = await runner.run(node, ["-e", "process.stdout.write('x'.repeat(500000))"], 10_000);

    expect(result.stdout.length).toBeLessThanOrEqual(64_000);
    expect(result.exitCode).toBe(0);
  });

  it("keeps the tail of capped output, where failures are reported", async () => {
    const result = await runner.run(node, ["-e", "process.stdout.write('a'.repeat(200000) + 'THE-END')"], 10_000);

    expect(result.stdout.endsWith("THE-END")).toBe(true);
  });

  it("uses only the supplied environment when one is given", async () => {
    process.env.LEAK_CHECK_VALUE = "should-not-appear";
    const result = await runner.run(node, ["-e", "console.log(process.env.LEAK_CHECK_VALUE ?? 'absent')"], 10_000, {
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    });
    delete process.env.LEAK_CHECK_VALUE;

    expect(result.stdout.trim()).toBe("absent");
  });

  it("rejects when the executable does not exist", async () => {
    await expect(runner.run("definitely-not-a-real-binary-xyz", [], 5_000)).rejects.toThrow();
  });
});

describe("ProcessCommandRunner: processes that leave children behind", () => {
  /** Like `cmd &`: the command spawns a background process that inherits our pipes
   * for 20s, does not wait for it, and exits. */
  // Python's subprocess.Popen inherits the pipe handles on every platform (Node's
  // spawn does not reliably do so on Windows), which is what reproduces the hang.
  const script = "import subprocess, sys; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'])";
  const backgroundJob = `python -c "${script}"`;

  it("REGRESSION: does not wait for a background process that outlives a command that finished normally", async () => {
    const startedAt = Date.now();
    const result = await runner.run(backgroundJob, [], 15_000, { shell: true });

    // The command itself exited at once; waiting for the pipes (20s, or the 15s timeout) would be a hang.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  it("REGRESSION: still returns promptly when a short timeout expires with such a background process alive", async () => {
    const startedAt = Date.now();
    await runner.run(backgroundJob, [], 700, { shell: true });

    expect(Date.now() - startedAt).toBeLessThan(6_000);
  }, 30_000);
});
