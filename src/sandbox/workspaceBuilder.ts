import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, posix, resolve, sep } from "node:path";

const KNOWN_APP_ROOTS = ["/app/", "/src/", "/workspace/"];

export class InvalidTargetPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTargetPathError";
  }
}

/** Strips a conventional app-root prefix (e.g. "/app/") and normalizes
 * Windows-style separators so the path can be replayed as a relative POSIX
 * path inside a Linux container. */
export function toContainerRelativePath(targetFilePath: string): string {
  const normalized = targetFilePath.trim().replace(/\\/g, "/");
  const matchedRoot = KNOWN_APP_ROOTS.find((root) => normalized.startsWith(root));

  const relative = matchedRoot
    ? normalized.slice(matchedRoot.length)
    : normalized.replace(/^[a-zA-Z]:\//, "").replace(/^\/+/, "");

  return posix.normalize(relative);
}

/** A path we can actually write a file at, inside the workspace. */
function assertWritableRelativePath(relativePath: string): void {
  if (relativePath.includes("\0")) {
    throw new InvalidTargetPathError("The target path contains a NUL character.");
  }
  if (relativePath === "." || relativePath === "" || relativePath.endsWith("/")) {
    throw new InvalidTargetPathError("The target path names a directory, not a file.");
  }
  if (relativePath === ".." || relativePath.startsWith("../")) {
    throw new InvalidTargetPathError("The target path escapes the workspace.");
  }
}

export interface SandboxWorkspace {
  workspaceDir: string;
  relativeFilePath: string;
  cleanup: () => Promise<void>;
}

/** Materializes the drafted remediation file on disk inside a throwaway
 * temp directory, mirroring its intended relative path, so it can be bind
 * mounted into the sandbox container for verification. The directory is
 * removed again if anything goes wrong before it is handed back. */
export async function buildSandboxWorkspace(targetFilePath: string, fileContent: string): Promise<SandboxWorkspace> {
  // Validate before creating anything, so a bad path can never leave a directory behind.
  const relativeFilePath = toContainerRelativePath(targetFilePath);
  assertWritableRelativePath(relativeFilePath);

  const workspaceDir = await mkdtemp(join(tmpdir(), "infra-agent-sandbox-"));
  const cleanup = async (): Promise<void> => {
    await rm(workspaceDir, { recursive: true, force: true });
  };

  try {
    const absoluteFilePath = join(workspaceDir, relativeFilePath);
    const root = resolve(workspaceDir);
    if (!resolve(absoluteFilePath).startsWith(root + sep)) {
      throw new InvalidTargetPathError("The target path escapes the workspace.");
    }

    await mkdir(dirname(absoluteFilePath), { recursive: true });
    await writeFile(absoluteFilePath, fileContent, "utf8");
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { workspaceDir, relativeFilePath, cleanup };
}
