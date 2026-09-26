import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../src/runs/redact.js";

describe("redactSensitive", () => {
  it.each([
    ["a URL with host and port", "connect to http://192.168.1.20:11434/api/chat failed", "connect to <url> failed"],
    ["a Windows path", "ENOENT C:\\Users\\alice\\proj\\x.js", "ENOENT <path>"],
    ["a POSIX home path", "cannot open /home/alice/.cache/x", "cannot open <path>"],
    ["a temp path", "spawn /tmp/sandbox-abc/run.sh", "spawn <path>"],
  ])("removes %s", (_label, input, expected) => {
    expect(redactSensitive(input)).toBe(expected);
  });

  it("leaves ordinary messages untouched", () => {
    expect(redactSensitive("Model returned an empty reply")).toBe("Model returned an empty reply");
  });
});
