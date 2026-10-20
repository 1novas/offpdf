import { describe, expect, it } from "vitest";
import {
  SHORTCUT_GROUPS,
  detectShortcutPlatform,
  formatShortcut,
  formatShortcutKeys,
  isEditableShortcutTarget,
  isShortcutsHelpHotkey,
} from "./shortcuts";

describe("shortcuts help", () => {
  it("SHORTCUTS-GUARD: `?` opens outside editable controls only", () => {
    expect(isShortcutsHelpHotkey({ key: "?" }, { tagName: "BODY" })).toBe(true);
    expect(isShortcutsHelpHotkey({ key: "?" }, { tagName: "BUTTON" })).toBe(true);

    expect(isShortcutsHelpHotkey({ key: "?" }, { tagName: "INPUT" })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "?" }, { tagName: "TEXTAREA" })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "?" }, { tagName: "SELECT" })).toBe(false);
    expect(
      isShortcutsHelpHotkey({ key: "?" }, { tagName: "DIV", isContentEditable: true }),
    ).toBe(false);

    expect(isShortcutsHelpHotkey({ key: "?", ctrlKey: true }, { tagName: "BODY" })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "?", metaKey: true }, { tagName: "BODY" })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "?", altKey: true }, { tagName: "BODY" })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "x" }, { tagName: "BODY" })).toBe(false);
  });

  it("SHORTCUTS-GUARD: missing or non-element targets are not editable", () => {
    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(isEditableShortcutTarget({})).toBe(false);
    expect(isEditableShortcutTarget({ tagName: 42 })).toBe(false);
    expect(isShortcutsHelpHotkey({ key: "?" })).toBe(true);
  });

  it("SHORTCUTS-MODIFIERS: macOS shows Command/Option, other platforms show Ctrl/Alt", () => {
    expect(formatShortcut(["Mod", "K"], "mac")).toBe("Command + K");
    expect(formatShortcut(["Mod", "Alt", "K"], "mac")).toBe("Command + Option + K");
    expect(formatShortcut(["Mod", "Shift", "Z"], "mac")).toBe("Command + Shift + Z");

    expect(formatShortcut(["Mod", "K"], "other")).toBe("Ctrl + K");
    expect(formatShortcut(["Mod", "Alt", "K"], "other")).toBe("Ctrl + Alt + K");
    expect(formatShortcut(["Mod", "Shift", "Z"], "other")).toBe("Ctrl + Shift + Z");
  });

  it("SHORTCUTS-MODIFIERS: literal keys pass through unchanged", () => {
    expect(formatShortcutKeys(["←", "+", "−", "0", "Escape"], "mac")).toEqual([
      "←",
      "+",
      "−",
      "0",
      "Escape",
    ]);
  });

  it("SHORTCUTS-PLATFORM: detects macOS from navigator-like input", () => {
    expect(detectShortcutPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectShortcutPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" })).toBe("mac");
    expect(detectShortcutPlatform({ platform: "Win32" })).toBe("other");
    expect(detectShortcutPlatform({ platform: "Linux x86_64" })).toBe("other");
    expect(detectShortcutPlatform(undefined)).toBe("other");
    expect(detectShortcutPlatform(null)).toBe("other");
  });

  it("SHORTCUTS-GROUPS: covers navigation, workspace, and Edit PDF actions", () => {
    expect(SHORTCUT_GROUPS.map((group) => group.id)).toEqual([
      "navigation",
      "workspace",
      "edit-pdf",
    ]);
    expect(SHORTCUT_GROUPS.map((group) => group.title)).toEqual([
      "Navigation",
      "Workspace",
      "Edit PDF",
    ]);

    for (const group of SHORTCUT_GROUPS) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.label.trim()).not.toBe("");
        expect(item.keys.length).toBeGreaterThan(0);
        expect(new Set(item.keys).size).toBe(item.keys.length);
      }
    }

    const ids = SHORTCUT_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("SHORTCUTS-GROUPS: documents the implemented Edit PDF shortcuts", () => {
    const editPdf = SHORTCUT_GROUPS.find((group) => group.id === "edit-pdf");
    const byId = new Map(editPdf?.items.map((item) => [item.id, item]));

    expect(byId.get("undo")?.keys).toEqual(["Mod", "Z"]);
    expect(byId.get("redo")?.keys).toEqual(["Mod", "Shift", "Z"]);
    expect(byId.get("copy")?.keys).toEqual(["Mod", "C"]);
    expect(byId.get("paste")?.keys).toEqual(["Mod", "V"]);
    expect(byId.get("duplicate")?.keys).toEqual(["Mod", "D"]);
    expect(byId.get("delete")?.keys).toEqual(["Delete"]);
    expect(byId.get("pan")?.keys).toEqual(["Space"]);
    expect(byId.get("hand-tool")?.keys).toEqual(["H"]);
  });
});
