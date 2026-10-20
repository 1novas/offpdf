import { describe, expect, it } from "vitest";
import { nextTrapIndex } from "./focusTrap";

describe("nextTrapIndex", () => {
  it("FOCUS-TRAP: moves forward and wraps to the first control", () => {
    expect(nextTrapIndex(-1, 3, false)).toBe(0);
    expect(nextTrapIndex(0, 3, false)).toBe(1);
    expect(nextTrapIndex(1, 3, false)).toBe(2);
    expect(nextTrapIndex(2, 3, false)).toBe(0);
  });

  it("FOCUS-TRAP: moves backwards and wraps to the last control", () => {
    expect(nextTrapIndex(-1, 3, true)).toBe(2);
    expect(nextTrapIndex(0, 3, true)).toBe(2);
    expect(nextTrapIndex(1, 3, true)).toBe(0);
    expect(nextTrapIndex(2, 3, true)).toBe(1);
  });

  it("FOCUS-TRAP: handles empty lists and out-of-range indices", () => {
    expect(nextTrapIndex(-1, 0, false)).toBe(-1);
    expect(nextTrapIndex(0, 0, true)).toBe(-1);
    expect(nextTrapIndex(9, 2, false)).toBe(0);
    expect(nextTrapIndex(9, 2, true)).toBe(1);
  });
});
