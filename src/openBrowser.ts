import { spawn } from "node:child_process";

export type Spawner = (command: string, args: string[]) => void;

const defaultSpawner: Spawner = (command, args) => {
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  // A machine with no browser or opener is fine; the URL is printed anyway.
  child.on("error", () => undefined);
  child.unref();
};

/** The command that opens a URL in the default browser on this platform. */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === "win32") {
    // `start` is a cmd builtin. The empty string is its window-title argument;
    // without it a quoted URL would be taken as the title.
    return { command: "cmd", args: ["/c", "start", '""', url] };
  }
  return platform === "darwin" ? { command: "open", args: [url] } : { command: "xdg-open", args: [url] };
}

/**
 * Opens `url` in the default browser. Only http(s) URLs are accepted, and the
 * URL is passed as a single argv entry (never through a shell string), so a
 * crafted value cannot smuggle in another command.
 */
export function openBrowser(url: string, spawner: Spawner = defaultSpawner, platform: NodeJS.Platform = process.platform): boolean {
  if (!/^https?:\/\/[\w.:[\]-]+(?:\/[\w./?=&%#-]*)?$/.test(url)) {
    return false;
  }
  const { command, args } = openCommand(url, platform);
  spawner(command, args);
  return true;
}
