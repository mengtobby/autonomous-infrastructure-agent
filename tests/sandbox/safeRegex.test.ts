import { describe, expect, it } from "vitest";
import { safeRegexTest } from "../../src/sandbox/safeRegex.js";
import { redactOutput, toRunResult } from "../../src/sandbox/sandboxResult.js";

describe("safeRegexTest", () => {
  it("reports a match and a non-match", async () => {
    expect(await safeRegexTest("VERIFIED", "all good\nVERIFIED\n")).toBe("match");
    expect(await safeRegexTest("VERIFIED", "nothing here")).toBe("no-match");
  });

  it("reports an invalid pattern rather than throwing", async () => {
    expect(await safeRegexTest("([unclosed", "x")).toBe("invalid");
  });

  it("REGRESSION: abandons a catastrophic-backtracking pattern instead of freezing the process", async () => {
    // ^(a+)+$ against 30 a's and a trailing '!' takes exponential time on the main thread.
    const started = Date.now();
    const outcome = await safeRegexTest("^(a+)+$", `${"a".repeat(30)}!`, 200);

    expect(outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 15_000);

  it("keeps the event loop responsive while a hostile pattern is being abandoned", async () => {
    let ticks = 0;
    const heartbeat = setInterval(() => (ticks += 1), 20);
    await safeRegexTest("^(a+)+$", `${"a".repeat(30)}!`, 300);
    clearInterval(heartbeat);

    // On the main thread this would be ~0 ticks: the loop would be blocked for the whole match.
    expect(ticks).toBeGreaterThan(3);
  }, 15_000);
});

describe("toRunResult", () => {
  const ok = { exitCode: 0, stdout: "hello\nVERIFIED\n", stderr: "", timedOut: false, durationMs: 5 };

  it("passes only when the exit code is 0 and the marker is present", async () => {
    expect((await toRunResult(ok, "VERIFIED")).passed).toBe(true);
    expect((await toRunResult({ ...ok, stdout: "hello" }, "VERIFIED")).passed).toBe(false);
    expect((await toRunResult({ ...ok, exitCode: 1 }, "VERIFIED")).passed).toBe(false);
    expect((await toRunResult({ ...ok, timedOut: true, exitCode: null }, "VERIFIED")).passed).toBe(false);
  });

  it("matches the marker in stderr as well as stdout", async () => {
    expect((await toRunResult({ ...ok, stdout: "", stderr: "VERIFIED" }, "VERIFIED")).passed).toBe(true);
  });

  it("treats an invalid regex as a literal marker", async () => {
    expect((await toRunResult({ ...ok, stdout: "saw ([literal here" }, "([literal")).passed).toBe(true);
    expect((await toRunResult({ ...ok, stdout: "nothing" }, "([literal")).passed).toBe(false);
  });

  it("REGRESSION: fails the run, with an explanation, when the pattern is catastrophic", async () => {
    const started = Date.now();
    const result = await toRunResult({ ...ok, stdout: `${"a".repeat(30)}!` }, "^(a+)+$");

    expect(result.passed).toBe(false);
    expect(result.stderr).toMatch(/took too long to evaluate/);
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 15_000);
});

describe("redactOutput", () => {
  const result = {
    exit_code: 1,
    stdout: "cwd: C:\\Users\\alice\\AppData\\Local\\Temp\\infra-agent-sandbox-abc",
    stderr: 'File "C:/Users/alice/AppData/Local/Temp/infra-agent-sandbox-abc/x.py", line 3',
    passed: false,
    timed_out: false,
    duration_ms: 1,
  };
  const workspace = "C:\\Users\\alice\\AppData\\Local\\Temp\\infra-agent-sandbox-abc";

  it("replaces the temp workspace path, in both slash styles, so the operator's username does not leak", () => {
    const redacted = redactOutput(result, [workspace]);

    expect(redacted.stdout).toBe("cwd: <sandbox>");
    expect(redacted.stderr).toBe('File "<sandbox>/x.py", line 3');
    expect(JSON.stringify(redacted)).not.toContain("alice");
  });

  it("leaves output alone when there is nothing to redact", () => {
    expect(redactOutput(result, [])).toEqual(result);
    expect(redactOutput(result, [""])).toEqual(result);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(result);
    redactOutput(result, [workspace]);
    expect(JSON.stringify(result)).toBe(before);
  });
});

describe("safeRegexTest: the fast path for patterns that cannot backtrack", () => {
  it("REGRESSION: a literal marker is not raced against the timeout, so a slow-to-start worker cannot falsely report it as abandoned", async () => {
    // A real timeoutMs (250ms default) can be shorter than worker startup takes
    // under load; an unsafe implementation would report "timeout" here.
    expect(await safeRegexTest("VERIFIED", "line one\nVERIFIED\n", 1)).toBe("match");
    expect(await safeRegexTest("VERIFIED", "nothing here", 1)).toBe("no-match");
  });

  it("still reports an invalid pattern for a malformed one that has no backtracking constructs", async () => {
    expect(await safeRegexTest("[unclosed", "x", 1)).toBe("invalid");
  });

  it("still routes anything with a repetition, group, alternation or escape through the worker", async () => {
    // These must still be caught by the timeout path if hostile; confirmed by the
    // catastrophic-backtracking test above. Here we only check ordinary cases still work.
    expect(await safeRegexTest("VERIFIED.*", "VERIFIEDxyz")).toBe("match");
    expect(await safeRegexTest("(VERIFIED|OK)", "OK")).toBe("match");
    expect(await safeRegexTest("VERIFIED\\d", "VERIFIED9")).toBe("match");
  });
});
