// Line diff (longest common subsequence) with intra-line highlighting, so the
// one character that separates a failing draft from its repair is visible.

/**
 * @param {string} before
 * @param {string} after
 * @returns {Array<{type: 'eq'|'add'|'del', text: string, oldNo: number|null, newNo: number|null, range?: [number, number]}>}
 */
export function diffLines(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  const table = lcsTable(a, b);

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "del", text: a[i], oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      ops.push({ type: "add", text: b[j], oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) ops.push({ type: "del", text: a[i], oldNo: i + 1, newNo: null });
  for (; j < b.length; j += 1) ops.push({ type: "add", text: b[j], oldNo: null, newNo: j + 1 });

  return markIntraline(ops);
}

/** Summary counts for a diff. */
export function diffStats(ops) {
  return ops.reduce(
    (stats, op) => ({
      added: stats.added + (op.type === "add" ? 1 : 0),
      removed: stats.removed + (op.type === "del" ? 1 : 0),
    }),
    { added: 0, removed: 0 }
  );
}

function splitLines(text) {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline is a line terminator, not an extra empty line.
  return lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
}

function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** Pairs each run of removed lines with the added lines that follow it and
 * marks the differing middle of each pair (common prefix/suffix trimmed). */
function markIntraline(ops) {
  const result = ops.map((op) => ({ ...op }));
  let index = 0;
  while (index < result.length) {
    if (result[index].type !== "del") {
      index += 1;
      continue;
    }
    const delStart = index;
    while (index < result.length && result[index].type === "del") index += 1;
    const addStart = index;
    while (index < result.length && result[index].type === "add") index += 1;

    const pairs = Math.min(addStart - delStart, index - addStart);
    for (let k = 0; k < pairs; k += 1) {
      const del = result[delStart + k];
      const add = result[addStart + k];
      const [delRange, addRange] = changedRanges(del.text, add.text);
      del.range = delRange;
      add.range = addRange;
    }
  }
  return result;
}

function changedRanges(before, after) {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;

  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return [
    [start, endBefore],
    [start, endAfter],
  ];
}
