import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain browser ES module with no type declarations
import { diffLines, diffStats } from "../../public/js/diff.js";

type Op = { type: string; text: string; oldNo: number | null; newNo: number | null; range?: [number, number] };

describe("diffLines", () => {
  it("reports identical text as all equal lines with both line numbers", () => {
    const ops: Op[] = diffLines("a\nb\n", "a\nb\n");
    expect(ops.map((op) => op.type)).toEqual(["eq", "eq"]);
    expect(ops[1]).toMatchObject({ oldNo: 2, newNo: 2 });
  });

  it("detects a changed line as a removal followed by an addition", () => {
    const ops: Op[] = diffLines("a\nb\nc\n", "a\nB\nc\n");
    expect(ops.map((op) => [op.type, op.text])).toEqual([
      ["eq", "a"],
      ["del", "b"],
      ["add", "B"],
      ["eq", "c"],
    ]);
  });

  it("detects pure insertions and deletions", () => {
    expect(diffLines("a\n", "a\nb\n").map((op: Op) => op.type)).toEqual(["eq", "add"]);
    expect(diffLines("a\nb\n", "a\n").map((op: Op) => op.type)).toEqual(["eq", "del"]);
  });

  it("handles empty inputs", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("", "x\n").map((op: Op) => op.type)).toEqual(["add"]);
    expect(diffLines("x\n", "").map((op: Op) => op.type)).toEqual(["del"]);
  });

  it("does not treat a trailing newline as an extra blank line", () => {
    expect(diffLines("a\n", "a")).toHaveLength(1);
    expect(diffLines("a\n", "a")[0].type).toBe("eq");
  });

  it("normalizes CRLF so line endings alone produce no diff", () => {
    expect(diffLines("a\r\nb\r\n", "a\nb\n").every((op: Op) => op.type === "eq")).toBe(true);
  });

  it("numbers lines in each version independently", () => {
    const ops: Op[] = diffLines("a\nx\nb\n", "a\nb\n");
    const removed = ops.find((op) => op.type === "del");
    const kept = ops.filter((op) => op.text === "b")[0];
    expect(removed).toMatchObject({ oldNo: 2, newNo: null });
    expect(kept).toMatchObject({ oldNo: 3, newNo: 2 });
  });

  it("marks exactly what changed inside a line, so the one-character bug is visible", () => {
    const before = 'return "{" + ",".join(f"{key}={val}" for key, val in label_set) + "}"';
    const after = 'return "{" + ",".join(f\'{key}="{val}"\' for key, val in label_set) + "}"';
    const [del, add]: Op[] = diffLines(`${before}\n`, `${after}\n`);

    expect(del.type).toBe("del");
    expect(add.type).toBe("add");
    expect(before.slice(...(del.range as [number, number]))).not.toBe("");
    expect(after.slice(...(add.range as [number, number]))).toContain('"');
    // Text outside the marked range is common to both lines.
    expect(before.slice(0, del.range![0])).toBe(after.slice(0, add.range![0]));
  });

  it("pairs multiple changed lines in order", () => {
    const ops: Op[] = diffLines("a1\nb1\n", "a2\nb2\n");
    expect(ops.filter((op) => op.range).length).toBe(4);
  });

  it("gives an unpaired removal no intra-line range", () => {
    const ops: Op[] = diffLines("a\nb\n", "a\n");
    expect(ops.find((op) => op.type === "del")?.range).toBeUndefined();
  });

  it("keeps a moderately large diff fast", () => {
    const big = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const changed = big.replace("line 200", "LINE 200");
    const started = Date.now();
    const stats = diffStats(diffLines(big, changed));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stats).toEqual({ added: 1, removed: 1 });
  });
});

describe("diffStats", () => {
  it("counts additions and removals only", () => {
    expect(diffStats(diffLines("a\nb\nc\n", "a\nx\ny\nc\n"))).toEqual({ added: 2, removed: 1 });
  });
});
