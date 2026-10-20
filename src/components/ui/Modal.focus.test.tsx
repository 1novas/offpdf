// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="trigger" onClick={() => setOpen(true)}>
        Open shortcuts
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog">
        <button type="button" id="first">
          First
        </button>
        <button type="button" id="second">
          Second
        </button>
      </Modal>
    </>
  );
}

function press(key: string, options: KeyboardEventInit = {}) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

function query<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

describe("Modal focus management", () => {
  it("MODAL-FOCUS: focuses the dialog, traps Tab, and restores trigger focus on Escape", () => {
    act(() => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const trigger = query<HTMLButtonElement>("#trigger");

    act(() => {
      trigger.focus();
    });
    expect(document.activeElement).toBe(trigger);

    act(() => {
      trigger.click();
    });

    const dialog = query<HTMLElement>('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);

    const first = query<HTMLButtonElement>("#first");
    const second = query<HTMLButtonElement>("#second");

    press("Tab");
    expect(document.activeElement).toBe(first);
    press("Tab");
    expect(document.activeElement).toBe(second);
    press("Tab");
    expect(document.activeElement).toBe(first);
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(second);

    press("Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
