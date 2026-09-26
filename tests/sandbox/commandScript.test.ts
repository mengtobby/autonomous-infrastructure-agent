import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { localScript, posixScript } from "../../src/sandbox/commandScript.js";

const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;

describe("posixScript", () => {
  it("puts each command on its own line under set -e", () => {
    expect(posixScript(["echo one", "echo two"])).toBe("set -e\necho one\necho two");
  });

  it.skipIf(!hasSh)("REGRESSION: a trailing # comment cannot swallow the commands after it", () => {
    // Joined with ' && ' the second command would be part of the comment and never run.
    const script = posixScript(['echo VERIFIED # smoke test', 'sh -c "exit 5"']);
    const result = spawnSync("sh", ["-c", script], { encoding: "utf8" });

    expect(result.stdout).toContain("VERIFIED");
    expect(result.status).toBe(5);
  });

  it.skipIf(!hasSh)("stops at the first failing command", () => {
    const result = spawnSync("sh", ["-c", posixScript(['sh -c "exit 3"', "echo SHOULD-NOT-RUN"])], { encoding: "utf8" });

    expect(result.status).toBe(3);
    expect(result.stdout).not.toContain("SHOULD-NOT-RUN");
  });

  it.skipIf(!hasSh)("runs every command when all succeed", () => {
    const result = spawnSync("sh", ["-c", posixScript(["echo a", "echo b"])], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(["a", "b"]);
  });
});

describe("localScript", () => {
  it("chains with && on Windows, where cmd.exe has no # comments and no set -e", () => {
    expect(localScript(["echo one", "echo two"], "win32")).toBe("echo one && echo two");
  });

  it("uses the safe multi-line script on POSIX platforms", () => {
    expect(localScript(["echo one", "echo two"], "linux")).toBe(posixScript(["echo one", "echo two"]));
    expect(localScript(["echo one"], "darwin")).toBe(posixScript(["echo one"]));
  });
});
