import { describe, expect, it, vi } from "vitest";
import { openBrowser, openCommand } from "../src/openBrowser.js";

describe("openCommand", () => {
  it("uses cmd's start builtin on Windows, with an explicit empty window title", () => {
    expect(openCommand("http://localhost:8787", "win32")).toEqual({ command: "cmd", args: ["/c", "start", '""', "http://localhost:8787"] });
  });

  it("uses open on macOS and xdg-open elsewhere", () => {
    expect(openCommand("http://localhost:8787", "darwin").command).toBe("open");
    expect(openCommand("http://localhost:8787", "linux").command).toBe("xdg-open");
  });
});

describe("openBrowser", () => {
  it("opens a local dashboard URL", () => {
    const spawner = vi.fn();
    expect(openBrowser("http://localhost:8787", spawner, "linux")).toBe(true);
    expect(spawner).toHaveBeenCalledWith("xdg-open", ["http://localhost:8787"]);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost:8787 & calc.exe",
    "http://localhost:8787; rm -rf /",
    'http://localhost:8787" && whoami',
    "http://localhost:8787\nhttp://evil.example",
    "$(reboot)",
    "",
  ])("refuses %j and never spawns anything", (url) => {
    const spawner = vi.fn();
    expect(openBrowser(url, spawner, "win32")).toBe(false);
    expect(spawner).not.toHaveBeenCalled();
  });
});
