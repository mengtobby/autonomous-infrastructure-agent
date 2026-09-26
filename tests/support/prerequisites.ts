import { expect, it } from "vitest";

/**
 * Some suites need things a developer's machine may lack (a browser, Python, a
 * POSIX shell) and skip themselves when they are missing. A skip is invisible
 * in a green run, so a machine without them would report success for tests
 * that never ran. With REQUIRE_E2E=1 (use it in CI and before a release) a
 * missing prerequisite becomes a failing test instead.
 */
export const requirePrerequisites = process.env.REQUIRE_E2E === "1";

export function assertPrerequisites(suite: string, present: Record<string, boolean>): void {
  if (!requirePrerequisites) {
    return;
  }
  it(`${suite}: every prerequisite is installed (REQUIRE_E2E=1)`, () => {
    const missing = Object.entries(present)
      .filter(([, installed]) => !installed)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
}
