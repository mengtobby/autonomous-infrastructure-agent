import type { EvalFixture } from "../types.js";
import { policyFixtures } from "./policy.js";
import { adversarialFixtures } from "./adversarial.js";
import { malformedFixtures } from "./malformed.js";
import { generationFixtures } from "./generation.js";

export const allFixtures: EvalFixture[] = [
  ...policyFixtures,
  ...adversarialFixtures,
  ...malformedFixtures,
  ...generationFixtures,
];
