import type { RiskLevel, RemediationAction } from "../src/schemas/remediation.schema.js";

export type EvalCategory = "policy" | "adversarial" | "malformed" | "generation";

export interface ContentExpectation {
  /** Substrings (case-insensitive) that must all appear in full_file_content. */
  mustContain: string[];
  /** Substrings (case-insensitive) of which at least one must appear —
   * for idioms with more than one valid spelling (e.g. `function` vs `=>`). */
  mustContainAnyOf?: string[];
  /** Regexes that must NOT match full_file_content — catches JSON-wrapped
   * pseudo-code, the most common local-model failure mode. */
  mustNotMatch: RegExp[];
  /** Minimum non-whitespace character count, to catch near-empty drafts. */
  minLength: number;
}

export interface EvalExpectation {
  schemaValid: boolean;
  isSafeToRemediate?: boolean;
  riskLevel?: RiskLevel;
  action?: RemediationAction;
  content?: ContentExpectation;
}

export interface EvalFixture {
  id: string;
  category: EvalCategory;
  description: string;
  /** Deliberately `unknown` — malformed fixtures must be able to violate the schema. */
  incidentRaw: unknown;
  expect: EvalExpectation;
}

export interface EvalCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface EvalResult {
  fixture: EvalFixture;
  skipped: boolean;
  checks: EvalCheck[];
}
