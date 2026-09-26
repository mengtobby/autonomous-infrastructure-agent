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

  it("flags a dedicated secrets directory as HIGH", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/secrets/stripe_api_key.txt" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("HIGH");
  });

  it("flags an underscore-joined credentials filename as HIGH", () => {
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/config/db_credentials.yaml" });
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("HIGH");
  });

  it("does not flag camelCase/PascalCase identifiers that merely contain 'secret'/'credential' as a substring", () => {
    // "secretSanitizer" and "UserCredential" are single compound identifiers with no
    // separator between the sensitive word and the rest — unlike snake_case/kebab-case
    // or a dedicated path segment, this is not a meaningful signal of secret material.
    const paths = ["/app/utils/secretSanitizer.ts", "/app/models/UserCredential.ts"];
    for (const targetFilePath of paths) {
      const result = checkPolicy({ ...baseInput, targetFilePath });
      expect(result.is_safe_to_remediate, `${targetFilePath} should not be blocked`).toBe(true);
      expect(result.risk_level, `${targetFilePath} should be LOW`).toBe("LOW");
    }
  });

  it("still flags snake_case-separated tokens like 'password_reset_service' as HIGH", () => {
    // Unlike the camelCase case above, an underscore is a real segment separator, so
    // "password" here is a standalone token — the same signal as a dedicated path segment.
    const result = checkPolicy({ ...baseInput, targetFilePath: "/app/services/password_reset_service.py" });
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

describe("checkPolicy: path tricks and wider coverage", () => {
  const level = (targetFilePath: string) => checkPolicy({ ...baseInput, targetFilePath });

  it.each([
    "//etc/cron.d/job",
    "/./etc/passwd",
    "/app/../etc/passwd",
    "/etc//passwd",
    "\\etc\\passwd",
    "/lib/x86_64-linux-gnu/libc.so",
    "/lib64/ld.so",
    "/dev/sda",
    "/run/secrets/token",
    "/private/etc/hosts",
    "C:/Windows/System32/x.dll",
    "C:\\Windows\\System32\\x.dll",
    "C:\\\\Windows\\\\System32\\\\x.dll",
  ])("blocks %s as CRITICAL", (path) => {
    const result = level(path);
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("CRITICAL");
  });

  it("blocks a NUL character as CRITICAL", () => {
    expect(level("/app/x\0.py").risk_level).toBe("CRITICAL");
  });

  it.each([
    "/home/deploy/.ssh/authorized_keys",
    "/app/keys/id_ed25519",
    "/app/keys/id_ecdsa",
    "/home/u/.npmrc",
    "/home/u/.pypirc",
    "/home/u/.netrc",
    "/home/u/.kube/config",
    "/home/u/.aws/config",
    "/app/certs/client.pfx",
    "/app/certs/store.p12",
    "/app/certs/trust.jks",
    "/app/certs/app.keystore",
    "/home/u/.gnupg/pubring.kbx",
  ])("blocks credential path %s as HIGH", (path) => {
    const result = level(path);
    expect(result.is_safe_to_remediate).toBe(false);
    expect(result.risk_level).toBe("HIGH");
  });

  it.each(["/app/utils..py", "/app/v1..2/module.py", "/app/my..module.py"])(
    "does not treat '..' inside a file name as traversal (%s)",
    (path) => {
      expect(level(path).is_safe_to_remediate).toBe(true);
    }
  );

  it.each(["/app/../x.py", "../x.py", "/app/..", "..\\x.py","/app/sub/../../x.py"])("still blocks '..' as a path segment (%s)", (path) => {
    expect(level(path).risk_level).toBe("CRITICAL");
  });

  it.each(["/app/library/x.py", "/app/device/driver.py", "/app/runner/x.py", "/app/lib_utils.py"])(
    "does not over-block ordinary paths that merely start like a system directory (%s)",
    (path) => {
      expect(level(path).risk_level).toBe("LOW");
    }
  );
});
