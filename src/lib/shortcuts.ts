/**
 * In-app keyboard shortcuts reference.
 *
 * `Mod` resolves to Command on macOS and Ctrl elsewhere; `Alt` resolves to
 * Option on macOS and Alt elsewhere. Only shortcuts that are actually wired up
 * in the desktop app belong here — keep the list honest.
 */

export type ShortcutPlatform = "mac" | "other";

export type ShortcutGroupId = "navigation" | "workspace" | "edit-pdf";

export interface ShortcutItem {
  id: string;
  label: string;
  /** Ordered key combination. See `formatShortcutKeys` for token handling. */
  keys: string[];
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "navigation",
    title: "Navigation",
    items: [
      { id: "focus-search", label: "Focus the tool search (Home)", keys: ["Mod", "K"] },
      { id: "open-shortcuts", label: "Open keyboard shortcuts", keys: ["?"] },
      { id: "close-layer", label: "Close a dialog or preview", keys: ["Escape"] },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    items: [
      { id: "previous-page", label: "Previous page in a preview", keys: ["←"] },
      { id: "next-page", label: "Next page in a preview", keys: ["→"] },
      { id: "zoom-in", label: "Zoom in (document preview)", keys: ["+"] },
      { id: "zoom-out", label: "Zoom out (document preview)", keys: ["−"] },
      { id: "zoom-reset", label: "Reset zoom (document preview)", keys: ["0"] },
    ],
  },
  {
    id: "edit-pdf",
    title: "Edit PDF",
    items: [
      { id: "undo", label: "Undo", keys: ["Mod", "Z"] },
      { id: "redo", label: "Redo", keys: ["Mod", "Shift", "Z"] },
      { id: "redo-alt", label: "Redo (alternative)", keys: ["Mod", "Y"] },
      { id: "copy", label: "Copy selection", keys: ["Mod", "C"] },
      { id: "paste", label: "Paste", keys: ["Mod", "V"] },
      { id: "duplicate", label: "Duplicate selection", keys: ["Mod", "D"] },
      { id: "delete", label: "Delete selection (or Backspace)", keys: ["Delete"] },
      { id: "nudge", label: "Nudge selection by 1 pt", keys: ["Arrow keys"] },
      { id: "nudge-fast", label: "Nudge selection by 10 pt", keys: ["Shift", "Arrow keys"] },
      { id: "pan", label: "Pan the page (hold and drag)", keys: ["Space"] },
      { id: "hand-tool", label: "Switch to the hand tool", keys: ["H"] },
      { id: "constrain", label: "Constrain a shape or rotation", keys: ["Shift"] },
      { id: "clear-selection", label: "Clear selection or cancel", keys: ["Escape"] },
    ],
  },
];

const MAC_LABELS: Record<string, string> = {
  Mod: "Command",
  Alt: "Option",
  Ctrl: "Control",
  Meta: "Command",
};

const OTHER_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Alt: "Alt",
  Ctrl: "Ctrl",
  Meta: "Ctrl",
};

/** Resolve a `navigator`-like object to the modifier convention it uses. */
export function detectShortcutPlatform(
  nav?: { platform?: string; userAgent?: string } | null,
): ShortcutPlatform {
  const probe = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(probe) ? "mac" : "other";
}

/** Turn key tokens into the labels shown on the current platform. */
export function formatShortcutKeys(keys: string[], platform: ShortcutPlatform): string[] {
  const labels = platform === "mac" ? MAC_LABELS : OTHER_LABELS;
  return keys.map((key) => labels[key] ?? key);
}

/** Human-readable shortcut, e.g. `Command + K` or `Ctrl + K`. */
export function formatShortcut(keys: string[], platform: ShortcutPlatform): string {
  return formatShortcutKeys(keys, platform).join(" + ");
}

/** Whether an event target is a text-entry/editable control. */
export function isEditableShortcutTarget(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * The `?` hotkey only fires outside editable controls and without modifiers,
 * so typing a question mark in a field never opens the dialog.
 */
export function isShortcutsHelpHotkey(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
  target?: unknown,
): boolean {
  if (event.key !== "?") return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !isEditableShortcutTarget(target);
}
