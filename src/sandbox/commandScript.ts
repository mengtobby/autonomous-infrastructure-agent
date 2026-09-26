/**
 * Turns a draft's test commands into one shell script.
 *
 * Joining with " && " on one line lets a trailing `#` comment in an early
 * command swallow every later command: `echo VERIFIED # ok && python fail.py`
 * exits 0 without ever running the second command, which would be a false
 * VERIFIED. One command per line, under `set -e`, keeps each command intact
 * and stops at the first failure.
 */
export function posixScript(commands: string[]): string {
  return ["set -e", ...commands].join("\n");
}

/**
 * The script for the local sandbox, which runs through the platform shell.
 * cmd.exe has no `#` comments (and no `set -e`), so " && " is both safe and
 * necessary there.
 */
export function localScript(commands: string[], platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? commands.join(" && ") : posixScript(commands);
}
