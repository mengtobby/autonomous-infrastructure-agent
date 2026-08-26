import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../src/isMainModule.js";

describe("isMainModule", () => {
  it("returns true when argv1's file URL matches import.meta.url", () => {
    const argv1 = "C:\\Users\\dev\\project\\dist\\server.js";
    expect(isMainModule(argv1, pathToFileURL(argv1).href)).toBe(true);
  });

  it("returns false when the module was only imported, not run directly", () => {
    const argv1 = "C:\\Users\\dev\\project\\node_modules\\.bin\\vitest";
    const importedModuleUrl = pathToFileURL("C:\\Users\\dev\\project\\dist\\server.js").href;
    expect(isMainModule(argv1, importedModuleUrl)).toBe(false);
  });

  it("returns false when argv1 is undefined", () => {
    expect(isMainModule(undefined, "file:///whatever")).toBe(false);
  });

  it("matches correctly on POSIX-style absolute paths too", () => {
    const argv1 = "/home/dev/project/dist/server.js";
    expect(isMainModule(argv1, pathToFileURL(argv1).href)).toBe(true);
  });

  it("regression: a naive file://${argv1} string concatenation does not match a real Windows import.meta.url", () => {
    // This is the exact bug: import.meta.url has a third slash before the
    // drive letter that manual concatenation doesn't produce, so the old
    // comparison always failed and the server's main() never ran on Windows.
    const argv1 = "C:\\Users\\dev\\project\\dist\\server.js";
    const naiveConcatenation = `file://${argv1.replace(/\\/g, "/")}`;
    const realImportMetaUrl = pathToFileURL(argv1).href;
    expect(naiveConcatenation).not.toBe(realImportMetaUrl);
    expect(isMainModule(argv1, realImportMetaUrl)).toBe(true);
  });
});
