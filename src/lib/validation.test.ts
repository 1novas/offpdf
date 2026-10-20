import { describe, expect, it } from "vitest";
import { validateFileName, validateOutputName } from "./validation";

describe("validateOutputName", () => {
  it("appends .pdf and enforces the 200-character limit on the normalized name", () => {
    expect(validateOutputName("a".repeat(196))).toEqual({
      ok: true,
      value: "a".repeat(196) + ".pdf",
    });
    expect(validateOutputName("a".repeat(197))).toEqual({
      ok: false,
      error: "That file name is too long.",
    });
  });

  it("does not append .pdf when the name already ends in it", () => {
    expect(validateOutputName("report.PDF")).toEqual({ ok: true, value: "report.PDF" });
    expect(validateOutputName("a".repeat(196) + ".pdf")).toEqual({
      ok: true,
      value: "a".repeat(196) + ".pdf",
    });
  });

  it("still rejects empty, invalid-character and reserved names", () => {
    expect(validateOutputName("  ")).toEqual({ ok: false, error: "Enter an output file name." });
    expect(validateOutputName("a<b")).toEqual({
      ok: false,
      error: 'A file name cannot contain: < > : " / \\ | ? *',
    });
    expect(validateOutputName("con")).toEqual({
      ok: false,
      error: "“con” is a reserved name on Windows.",
    });
  });
});

describe("validateFileName", () => {
  it("normalizes an arbitrary extension", () => {
    expect(validateFileName("notes", ".txt")).toEqual({
      ok: true,
      value: "notes.txt",
    });
    expect(validateFileName("notes.TXT", ".txt")).toEqual({
      ok: true,
      value: "notes.TXT",
    });
    expect(validateFileName(" report ", ".pdf")).toEqual({
      ok: true,
      value: "report.pdf",
    });
  });

  it("rejects path fragments and Windows-unsafe names", () => {
    for (const name of ["../escape", "sub/file", "C:\\temp\\out", "C:/temp/out"]) {
      expect(validateFileName(name, ".pdf").ok).toBe(false);
    }

    expect(validateFileName(".", ".pdf")).toEqual({
      ok: false,
      error: "A file name cannot end with a dot or space.",
    });
    expect(validateFileName("..", ".pdf")).toEqual({
      ok: false,
      error: "A file name cannot end with a dot or space.",
    });
    expect(validateFileName("report.", ".pdf")).toEqual({
      ok: false,
      error: "A file name cannot end with a dot or space.",
    });
  });
});
