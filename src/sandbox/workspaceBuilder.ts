import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";

const KNOWN_APP_ROOTS = ["/app/", "/src/", "/workspace/"];

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

export interface SandboxWorkspace {
  workspaceDir: string;
  relativeFilePath: string;
  cleanup: () => Promise<void>;
}

/** Materializes the drafted remediation file on disk inside a throwaway
 * temp directory, mirroring its intended relative path, so it can be bind
 * mounted into the sandbox container for verification. */
export async function buildSandboxWorkspace(targetFilePath: string, fileContent: string): Promise<SandboxWorkspace> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "infra-agent-sandbox-"));
  const relativeFilePath = toContainerRelativePath(targetFilePath);
  const absoluteFilePath = join(workspaceDir, relativeFilePath);

  await mkdir(dirname(absoluteFilePath), { recursive: true });
  await writeFile(absoluteFilePath, fileContent, "utf8");

  return {
    workspaceDir,
    relativeFilePath,
    cleanup: async () => {
      await rm(workspaceDir, { recursive: true, force: true });
    },
  };
}
