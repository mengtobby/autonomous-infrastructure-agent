import { describe, expect, it } from "vitest";
// @ts-expect-error - browser module without type declarations
import { describeError } from "../../public/js/describeError.js";
// @ts-expect-error - browser module without type declarations
import { ApiError } from "../../public/js/api.js";

describe("describeError", () => {
  it("uses an ApiError's own message, written to be shown to the person using the dashboard", () => {
    expect(describeError(new ApiError("Reload the page."))).toBe("Reload the page.");
  });

  it("stringifies anything else by default", () => {
    expect(describeError(new Error("boom"))).toBe("Error: boom");
    expect(describeError("plain string")).toBe("plain string");
  });

  it("uses the caller's fallback for anything that isn't an ApiError", () => {
    expect(describeError(new Error("boom"), "Something went wrong.")).toBe("Something went wrong.");
  });

  it("still prefers the ApiError's message over a supplied fallback", () => {
    expect(describeError(new ApiError("Specific reason."), "Generic fallback.")).toBe("Specific reason.");
  });
});
