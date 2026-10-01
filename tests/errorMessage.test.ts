import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/errorMessage.js";

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("subclasses of Error too", () => {
    class CustomError extends Error {}
    expect(errorMessage(new CustomError("custom boom"))).toBe("custom boom");
  });

  it("stringifies anything that was thrown but isn't an Error", () => {
    expect(errorMessage("a string")).toBe("a string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
