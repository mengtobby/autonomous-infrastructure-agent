import { describe, expect, it } from "vitest";
import { validateContainerImage } from "../../src/sandbox/containerImage.js";

describe("validateContainerImage", () => {
  it.each(["python:3.11-slim", "node:20-slim", "golang:1.22", "alpine", "eclipse-temurin:21-jdk", "python"])(
    "accepts the official image %s",
    (image) => {
      expect(validateContainerImage(image).valid).toBe(true);
    }
  );

  it.each([
    ["a private registry", "registry.evil.io/team/image:1"],
    ["an unlisted repository", "attacker/miner:latest"],
    ["an image pinned by digest", "python@sha256:abc123"],
    ["a flag-shaped value", "--privileged"],
    ["a value with whitespace", "python:3.11 --privileged"],
    ["an empty string", ""],
    ["shell metacharacters", "python:3.11;rm -rf /"],
  ])("rejects %s", (_label, image) => {
    expect(validateContainerImage(image).valid).toBe(false);
  });

  it("explains why an image was refused", () => {
    const result = validateContainerImage("attacker/miner");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/allowlist|plain image reference/);
    }
  });
});
