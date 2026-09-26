/**
 * Error text from the model client, the sandbox and the OS routinely contains
 * things a remote visitor has no business seeing: the Ollama base URL, the
 * operator's home directory (and so their username), temp paths. Run history
 * is served to every visitor of the dashboard, so it is scrubbed before it is
 * stored. The CLI, which is the operator's own terminal, is unaffected.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)]+/gi;
const WINDOWS_PATH = /\b[A-Za-z]:[\\/][^\s"'<>|?*]+/g;
const POSIX_HOME_PATH = /(?:\/(?:home|Users|root|tmp|var|private|opt|srv|mnt)\/[^\s"'<>:]*)/g;

export function redactSensitive(text: string): string {
  return text.replace(URL_PATTERN, "<url>").replace(WINDOWS_PATH, "<path>").replace(POSIX_HOME_PATH, "<path>");
}
