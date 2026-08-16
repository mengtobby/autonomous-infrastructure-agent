import { describe, expect, it } from "vitest";
import { checkPolicy } from "../../src/core/policyChecker.js";

const baseInput = {
  errorLog: "ModuleNotFoundError: No module named 'x'",
  serviceRequirementsContext: "Needs a class with method foo()",
};

describe("checkPolicy", () => {
  it("allows an ordinary application module path with LOW risk", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/collectors/metrics_exporter.py" });
    expect(result.is_safe_to_remediate).toBe(true);
    expect(result.risk_level).toBe("LOW");
  });

  it("blocks empty target file paths as CRITICAL", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "   " });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("CRITICAL");
  });

  it("blocks path traversal attempts as CRITICAL", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/../../etc/passwd" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("CRITICAL");
  });

  it("blocks writes under system directories as CRITICAL", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/etc/nginx/nginx.conf" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("CRITICAL");
  });

  it("blocks writes to Windows system directories as CRITICAL", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "C:\\Windows\\System32\\drivers\\etc\\hosts" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("CRITICAL");
  });

  it("flags secret-looking paths as HIGH and blocks auto-remediation", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/config/.env.production" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("HIGH");
  });

  it("allows shared-infra config creation but flags MEDIUM risk", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/deploy/docker-compose.yml" });
    expect(result.is_safe_to_remediate).toBe(true);
    expect(result.risk_level).toBe("MEDIUM");
  });

  it("always includes non-empty risk_reasoning", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/utils/formatter.ts" });
    expect(result.risk_reasoning.length).toBeGreaterThan(0);
  });
});
