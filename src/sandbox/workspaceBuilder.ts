import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";

const KNOWN_APP_ROOTS = ["/app/", "/src/", "/workspace/"];

/** Strips a conventional app-root prefix (e.g. "/app/") and normalizes
 * Windows-style separators so the path can be replayed as a relative POSIX
 * path inside a Linux container. */
export function toContainerRelativePath(targetFilePath: string): string {
  let path = targetFilePath.trim().replace(/\\/g, "/");

  for (const root of KNOWN_APP_ROOTS) {
    if (path.startsWith(root)) {
      path = path.slice(root.length);
      return posix.normalize(path);
    }
  }

  path = path.replace(/^[a-zA-Z]:\//, "").replace(/^\/+/, "");
  return posix.normalize(path);
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
  const absoluteFilePath = join(workspaceDir, ...relativeFilePath.split("/"));

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
