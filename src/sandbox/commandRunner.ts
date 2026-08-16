export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Abstraction over process execution so the Docker sandbox runner can be
 * unit tested without spawning a real `docker` process. */
export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number): Promise<CommandResult>;
}
