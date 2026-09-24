import { spawn, type ChildProcess } from "node:child_process";
import type { CommandOptions, CommandResult, CommandRunner } from "./commandRunner.js";

/** Cap per stream. A drafted program that prints in a loop must not be able
 * to exhaust this process's memory; the tail is kept because that is where
 * assertion failures and tracebacks end up. */
const MAX_OUTPUT_CHARS = 64_000;

/** Executes a command as a real child process, enforcing a hard timeout by
 * killing the whole process tree if it runs longer than allowed. */
export class ProcessCommandRunner implements CommandRunner {
  async run(command: string, args: string[], timeoutMs: number, options: CommandOptions = {}): Promise<CommandResult> {
    const startedAt = Date.now();

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd,
        env: options.env,
        shell: options.shell ?? false,
        windowsHide: true,
        // A new process group lets us kill grandchildren on POSIX.
        detached: process.platform !== "win32",
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk.toString("utf8"));
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - startedAt });
      });
    });
  }
}

function appendCapped(existing: string, addition: string): string {
  const combined = existing + addition;
  return combined.length > MAX_OUTPUT_CHARS ? combined.slice(combined.length - MAX_OUTPUT_CHARS) : combined;
}

/** `child.kill()` on a shell-spawned process only terminates the shell on
 * Windows, leaving the real workload running — so kill the whole tree. */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {
      child.kill();
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
