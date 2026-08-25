import { resolve, sep } from "node:path";

export interface WriteTargetResolution {
  path: string;
  withinProjectRoot: boolean;
}

/**
 * Resolves target_file_path to a location under projectRoot, defeating any
 * path (accidental or not) that would otherwise escape the project
 * directory — a Windows drive-letter absolute path (`C:\Users\...`) or a
 * POSIX-absolute path that isn't actually a container-relative convention.
 * The policy checker labels risk for informational/gating purposes; this is
 * the hard containment boundary at the point a file actually gets written.
 */
export function resolveWriteTarget(projectRoot: string, targetFilePath: string): WriteTargetResolution {
  const withoutDriveLetter = targetFilePath.replace(/^[A-Za-z]:[\\/]/, "");
  const withoutLeadingSeparators = withoutDriveLetter.replace(/^[\\/]+/, "");

  const resolvedRoot = resolve(projectRoot);
  const resolvedPath = resolve(resolvedRoot, withoutLeadingSeparators);

  const withinProjectRoot = resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep);

  return { path: resolvedPath, withinProjectRoot };
}
