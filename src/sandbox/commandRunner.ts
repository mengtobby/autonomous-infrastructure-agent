export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CommandOptions {
  cwd?: string;
  /** Replaces the environment entirely when set (nothing is inherited). */
  env?: Record<string, string>;
  /** Run `command` through the platform shell (needed for `&&` chains). */
  shell?: boolean;
}

/** Abstraction over process execution so the sandbox runners can be
 * unit tested without spawning a real process. */
export interface CommandRunner {
  run(command: string, args: string[], timeoutMs: number, options?: CommandOptions): Promise<CommandResult>;
}
