/**
 * The model chooses `container_image`, and that string ends up as an argument
 * to `docker run` — so it is untrusted input. Only well-known official
 * language-runtime images are accepted; anything else (a private registry, a
 * digest, or a value starting with "-" that Docker would parse as a flag) is
 * refused before any process is spawned.
 */
const ALLOWED_REPOSITORIES = new Set([
  "python",
  "node",
  "golang",
  "ruby",
  "php",
  "rust",
  "eclipse-temurin",
  "openjdk",
  "alpine",
  "busybox",
  "debian",
  "ubuntu",
]);

const IMAGE_REFERENCE = /^([a-z0-9]+(?:[._-][a-z0-9]+)*)(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,127}))?$/;

export function validateContainerImage(image: string): { valid: true } | { valid: false; reason: string } {
  const match = IMAGE_REFERENCE.exec(image.trim());
  if (!match) {
    return { valid: false, reason: `'${image}' is not a plain image reference (expected name[:tag]).` };
  }

  const repository = match[1] ?? "";
  if (!ALLOWED_REPOSITORIES.has(repository)) {
    return {
      valid: false,
      reason: `Image '${repository}' is not on the sandbox allowlist (${[...ALLOWED_REPOSITORIES].join(", ")}).`,
    };
  }

  return { valid: true };
}
