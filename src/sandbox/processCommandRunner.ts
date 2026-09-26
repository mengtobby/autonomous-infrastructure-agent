import { spawn, type ChildProcess } from "node:child_process";
import type { CommandOptions, CommandResult, CommandRunner } from "./commandRunner.js";

/** Cap per stream. A drafted program that prints in a loop must not be able
 * to exhaust this process's memory; the tail is kept because that is where
 * assertion failures and tracebacks end up. */
const MAX_OUTPUT_CHARS = 64_000;

/** After the command itself has exited, how long to wait for its output to
 * drain before giving up on pipes a background process still holds open. */
const DRAIN_GRACE_MS = 300;

/** After a timeout kill, how long to wait for the process to be reaped. */
const KILL_GRACE_MS = 1_000;

/**
 * Executes a command as a real child process, enforcing a hard timeout by
 * killing the whole process tree if it runs longer than allowed.
 *
 * The result is delivered when the command itself is done, not when every
 * descendant has closed its inherited pipes. Waiting for `close` alone would
 * let a drafted program hang the caller forever with `cmd & sleep 1e9`: the
 * command exits, but the orphan keeps stdout open and `close` never fires.
 */
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
      let settled = false;
      const timers: NodeJS.Timeout[] = [];

      const settle = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - startedAt });
      };

      /** Stops listening to pipes a stray descendant may hold open forever. */
      const releasePipes = (): void => {
        child.stdout.destroy();
        child.stderr.destroy();
      };

      timers.push(
        setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
          timers.push(
            setTimeout(() => {
              releasePipes();
              settle(null);
            }, KILL_GRACE_MS)
          );
        }, timeoutMs)
      );

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk.toString("utf8"));
      });

      child.on("error", (error) => {
        timers.forEach(clearTimeout);
        settled = true;
        reject(error);
      });

      // The command is done. Normally `close` follows at once with all output;
      // if it does not, a background process is holding the pipes, so stop waiting.
      child.on("exit", (exitCode) => {
        timers.push(
          setTimeout(() => {
            releasePipes();
            settle(exitCode);
          }, DRAIN_GRACE_MS)
        );
      });

      child.on("close", (exitCode) => settle(exitCode));
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
