import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./commandRunner.js";

/** Executes a command as a real child process, enforcing a hard timeout by
 * killing the process tree if it runs longer than allowed. */
export class ProcessCommandRunner implements CommandRunner {
  async run(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    const startedAt = Date.now();

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}
