import { pathToFileURL } from "node:url";

/**
 * True when this module was invoked directly as a script (`node path/to/file.js`),
 * false when it was only imported by another module (e.g. a test file importing
 * buildApp). Comparing import.meta.url against a manually built `file://` string
 * breaks on Windows — import.meta.url has a third slash before the drive letter
 * (file:///C:/...) that naive string concatenation (file://C:/...) doesn't
 * produce, so the comparison silently always failed. pathToFileURL() builds the
 * URL the same way Node computes import.meta.url, so this comparison is exact
 * on every platform.
 */
export function isMainModule(argv1: string | undefined, importMetaUrl: string): boolean {
  return argv1 !== undefined && importMetaUrl === pathToFileURL(argv1).href;
}
