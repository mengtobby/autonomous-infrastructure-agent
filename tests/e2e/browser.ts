import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

/**
 * Finds a Chromium to drive. Order: an explicit override, Playwright's own
 * install, then any headless shell already cached on this machine (a
 * different Playwright version may have downloaded it). Returns undefined
 * when there is none, and the e2e suite skips rather than failing.
 */
export function findChromium(): string | undefined {
  const override = process.env.E2E_CHROMIUM_PATH;
  if (override && existsSync(override)) return override;

  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;

  const roots = [join(process.env.LOCALAPPDATA ?? "", "ms-playwright"), join(homedir(), ".cache", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((name) => name.startsWith("chromium_headless_shell")).sort().reverse()) {
      for (const candidate of [
        join(root, entry, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
        join(root, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(root, entry, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export async function launch(executablePath: string): Promise<Browser> {
  return chromium.launch({ executablePath });
}
