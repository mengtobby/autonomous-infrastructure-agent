import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeRemediation } from "../../src/cli/writeRemediation.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-remediation-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeRemediation", () => {
  it("creates the file, and any missing parent directories", async () => {
    const target = join(dir, "app", "collectors", "exporter.py");

    expect(await writeRemediation(target, "fixed\n", false)).toBe("written");
    expect(await readFile(target, "utf8")).toBe("fixed\n");
  });

  it("refuses to overwrite an existing file and leaves it untouched", async () => {
    const target = join(dir, "exporter.py");
    await writeFile(target, "original\n");

    expect(await writeRemediation(target, "fixed\n", false)).toBe("exists");
    expect(await readFile(target, "utf8")).toBe("original\n");
  });

  it("overwrites when forced", async () => {
    const target = join(dir, "exporter.py");
    await writeFile(target, "original\n");

    expect(await writeRemediation(target, "fixed\n", true)).toBe("written");
    expect(await readFile(target, "utf8")).toBe("fixed\n");
  });

  it("propagates other failures, such as the target being a directory", async () => {
    await expect(writeRemediation(dir, "x", true)).rejects.toThrow();
  });
});
