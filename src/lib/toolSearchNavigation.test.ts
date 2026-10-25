import { describe, expect, it } from "vitest";
import { nextToolSearchIndex } from "./toolSearchNavigation";

describe("nextToolSearchIndex", () => {
  it("HS-NAV-NONE: an empty result list never has an active item", () => {
    expect(nextToolSearchIndex(-1, 0, "down")).toBe(-1);
    expect(nextToolSearchIndex(-1, 0, "up")).toBe(-1);
    expect(nextToolSearchIndex(0, 0, "down")).toBe(-1);
  });

  it("HS-NAV-START: Down starts at the first result and Up starts at the last", () => {
    expect(nextToolSearchIndex(-1, 4, "down")).toBe(0);
    expect(nextToolSearchIndex(-1, 4, "up")).toBe(3);
  });

  it("HS-NAV-MOVE: moves one result at a time", () => {
    expect(nextToolSearchIndex(0, 4, "down")).toBe(1);
    expect(nextToolSearchIndex(2, 4, "up")).toBe(1);
  });

  it("HS-NAV-CLAMP: the first and last results stay selected at the boundaries", () => {
    expect(nextToolSearchIndex(0, 4, "up")).toBe(0);
    expect(nextToolSearchIndex(3, 4, "down")).toBe(3);
  });

  it("HS-NAV-STALE: an out-of-range index recovers to the nearest edge", () => {
    expect(nextToolSearchIndex(9, 4, "down")).toBe(0);
    expect(nextToolSearchIndex(9, 4, "up")).toBe(3);
  });
});
