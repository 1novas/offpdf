import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";
import { ShortcutsDialog } from "./ShortcutsDialog";

const noop = () => {};

describe("ShortcutsDialog", () => {
  it("SHORTCUTS-RENDER: closed dialog renders nothing", () => {
    const markup = renderToStaticMarkup(
      <ShortcutsDialog open={false} onClose={noop} platform="other" />,
    );
    expect(markup).toBe("");
  });

  it("SHORTCUTS-RENDER: opens as a modal with every group and label", () => {
    const markup = renderToStaticMarkup(<ShortcutsDialog open onClose={noop} platform="other" />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Keyboard shortcuts");

    for (const group of SHORTCUT_GROUPS) {
      expect(markup).toContain(group.title);
      for (const item of group.items) {
        expect(markup).toContain(item.label);
      }
    }
  });

  it("SHORTCUTS-LABELS: Windows/Linux uses Ctrl and Alt terminology", () => {
    const markup = renderToStaticMarkup(<ShortcutsDialog open onClose={noop} platform="other" />);

    expect(markup).toContain("Ctrl");
    expect(markup).toContain("Alt");
    expect(markup).not.toContain("Command");
    expect(markup).not.toContain("Option");
  });

  it("SHORTCUTS-LABELS: macOS uses Command and Option terminology", () => {
    const markup = renderToStaticMarkup(<ShortcutsDialog open onClose={noop} platform="mac" />);

    expect(markup).toContain("Command");
    expect(markup).toContain("Option");
    expect(markup).not.toContain("Ctrl");
    expect(markup).not.toContain("Alt");
  });
});
