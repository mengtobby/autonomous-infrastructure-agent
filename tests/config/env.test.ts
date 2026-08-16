import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, requireAnthropicApiKey, _resetConfigCacheForTests } from "../../src/config/env.js";

const ORIGINAL_ENV = { ...process.env };

describe("loadConfig", () => {
  beforeEach(() => {
    _resetConfigCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    _resetConfigCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  it("applies documented defaults when optional vars are unset", () => {
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.PORT;
    delete process.env.SANDBOX_CPU_LIMIT;

    const config = loadConfig();

    expect(config.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
    expect(config.PORT).toBe(8787);
    expect(config.SANDBOX_CPU_LIMIT).toBe("0.5");
  });

  it("does not throw when ANTHROPIC_API_KEY is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).not.toThrow();
  });

  it("requireAnthropicApiKey throws a descriptive error when the key is absent", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const config = loadConfig();
    expect(() => requireAnthropicApiKey(config)).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("requireAnthropicApiKey returns the key when present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    const config = loadConfig();
    expect(requireAnthropicApiKey(config)).toBe("sk-test-123");
  });
});
