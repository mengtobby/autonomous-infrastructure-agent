import { describe, expect, it } from "vitest";
// @ts-expect-error - browser module without type declarations
import { describeTruth } from "../../public/js/views/topbar.js";

const local = { mode: "local", available: true, note: "" };

describe("describeTruth", () => {
  it("attributes the local sandbox to recorded, synthetic incidents in replay mode", () => {
    const truth = describeTruth({ provider: "replay", model: null, sandbox: local });

    expect(truth.model.label).toBe("Recorded drafts");
    expect(truth.sandbox.tone).toBe("warning");
    expect(truth.sandbox.body).toMatch(/recorded, synthetic/);
  });

  it("does not claim the incidents are recorded when a live model is writing the code", () => {
    const truth = describeTruth({ provider: "ollama", model: "llama3.1", sandbox: local });

    expect(truth.model.label).toBe("Local model · llama3.1");
    expect(truth.sandbox.body).not.toMatch(/recorded, synthetic/);
    expect(truth.sandbox.body).toMatch(/writing this code live/);
  });

  it("says plainly when Docker is configured but unavailable", () => {
    const truth = describeTruth({ provider: "ollama", model: "m", sandbox: { mode: "docker", available: false, note: "" } });

    expect(truth.sandbox.label).toBe("Sandbox unavailable");
  });
});
