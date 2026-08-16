import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, _resetConfigCacheForTests } from "../../src/config/env.js";

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
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.PORT;
    delete process.env.SANDBOX_CPU_LIMIT;

    const config = loadConfig();

    expect(config.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(config.OLLAMA_MODEL).toBe("qwen2.5-coder:7b");
    expect(config.PORT).toBe(8787);
    expect(config.SANDBOX_CPU_LIMIT).toBe("0.5");
  });

  it("never requires a secret to be present (fully local, no API key)", () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it("honors an overridden OLLAMA_BASE_URL and OLLAMA_MODEL", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11500";
    process.env.OLLAMA_MODEL = "llama3.1:8b";

    const config = loadConfig();

    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11500");
    expect(config.OLLAMA_MODEL).toBe("llama3.1:8b");
  });

  it("rejects a malformed OLLAMA_BASE_URL", () => {
    process.env.OLLAMA_BASE_URL = "not-a-url";
    expect(() => loadConfig()).toThrow(/Invalid environment configuration/);
  });
});
