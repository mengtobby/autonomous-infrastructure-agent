import type { PolicyCheck, RiskLevel } from "../schemas/remediation.schema.js";

const SYSTEM_PATH_PATTERNS = [
  /^\/etc(\/|$)/i,
  /^\/bin(\/|$)/i,
  /^\/sbin(\/|$)/i,
  /^\/usr(\/|$)/i,
  /^\/boot(\/|$)/i,
  /^\/root(\/|$)/i,
  /^\/var\/run(\/|$)/i,
  /^\/sys(\/|$)/i,
  /^\/proc(\/|$)/i,
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files/i,
];

const SECRET_PATH_PATTERNS = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /secret/i,
  /credential/i,
  /password/i,
];

const SHARED_INFRA_PATTERNS = [
  /docker-compose/i,
  /^dockerfile$/i,
  /\/dockerfile$/i,
  /\.ya?ml$/i,
  /\.tf$/i,
  /migrations?\//i,
  /nginx\.conf$/i,
  /\.sql$/i,
];

export interface PolicyCheckInput {
  targetFilePath: string;
  errorLog: string;
  serviceRequirementsContext: string;
}

/**
 * Deterministic, prompt-injection-proof safety gate. Risk classification is
 * derived only from the file path (not from LLM output or free-text context),
 * so a compromised or hallucinated model response cannot talk its way past it.
 */
export function checkPolicy(input: PolicyCheckInput): PolicyCheck {
  const normalizedPath = input.targetFilePath.trim();

  if (normalizedPath.length === 0) {
    return blocked("CRITICAL", "target_file_path is empty; refusing to remediate an unspecified location.");
  }

  if (normalizedPath.includes("..")) {
    return blocked("CRITICAL", `Path traversal segment detected in '${normalizedPath}'; refusing to write outside the intended module tree.`);
  }

  if (SYSTEM_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return blocked("CRITICAL", `'${normalizedPath}' resolves under a system directory; automated writes there are never permitted.`);
  }

  if (SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return blocked("HIGH", `'${normalizedPath}' matches a secret/credential naming pattern; requires human review before any content is written.`);
  }

  if (SHARED_INFRA_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return allowed(
      "MEDIUM",
      `'${normalizedPath}' affects shared infrastructure configuration (deployment/migration/manifest); auto-remediation permitted for file creation but changes should be reviewed before deploy.`
    );
  }

  return allowed("LOW", `'${normalizedPath}' is an ordinary application module; creating the missing file carries no elevated risk.`);
}

function blocked(riskLevel: RiskLevel, reasoning: string): PolicyCheck {
  return { is_safe_to_remediate: false, risk_level: riskLevel, risk_reasoning: reasoning };
}

function allowed(riskLevel: RiskLevel, reasoning: string): PolicyCheck {
  return { is_safe_to_remediate: true, risk_level: riskLevel, risk_reasoning: reasoning };
}
