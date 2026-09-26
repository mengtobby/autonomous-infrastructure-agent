import { describe, expect, it } from "vitest";
import { exposureProblem } from "../../src/config/exposure.js";

describe("exposureProblem", () => {
  it.each(["127.0.0.1", "::1", "localhost"])("allows anything on loopback (%s)", (HOST) => {
    expect(exposureProblem({ HOST, LLM_PROVIDER: "ollama", SANDBOX_MODE: "local" })).toBeNull();
  });

  it("refuses a live model with the non-isolated local sandbox on a public interface", () => {
    expect(exposureProblem({ HOST: "0.0.0.0", LLM_PROVIDER: "ollama", SANDBOX_MODE: "local" })).toMatch(/Refusing to listen/);
  });

  it.each([
    ["docker sandbox", "ollama", "docker"],
    ["replay provider", "replay", "local"],
    ["sandbox off", "ollama", "off"],
  ] as const)("allows a public interface with %s", (_label, LLM_PROVIDER, SANDBOX_MODE) => {
    expect(exposureProblem({ HOST: "0.0.0.0", LLM_PROVIDER, SANDBOX_MODE })).toBeNull();
  });
});
