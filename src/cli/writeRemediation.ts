import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type WriteOutcome = "written" | "exists";

/** Writes a verified fix to disk. An existing file is never replaced unless the
 * caller asked for it: the agent's whole premise is that it is fixing a file
 * that is *missing*, so finding one there means the situation is not what the
 * incident described. The exclusive-create flag makes the check race-free. */
export async function writeRemediation(targetPath: string, content: string, force: boolean): Promise<WriteOutcome> {
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await writeFile(targetPath, content, { encoding: "utf8", flag: force ? "w" : "wx" });
    return "written";
  } catch (error) {
    if (!force && (error as NodeJS.ErrnoException).code === "EEXIST") {
      return "exists";
    }
    throw error;
  }
}
