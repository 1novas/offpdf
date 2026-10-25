// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "@/lib/tools";
import { HomeToolsSection } from "./HomeToolsSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type CategoryFilter = "All" | "Organize" | "Convert" | "Optimize & secure";

type SectionProps = {
  query: string;
  category: CategoryFilter;
  onOpen: (path: string) => void;
};

let live: { root: Root; container: HTMLDivElement } | null = null;

afterEach(() => {
  if (!live) return;
  const { root, container } = live;
  live = null;
  act(() => {
    root.unmount();
  });
  container.remove();
});

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search tools"]');
  if (!input) throw new Error("search input not found");
  return input;
}

function toolCards(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".tool-card")];
}

function activeCards(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".tool-card.is-active")];
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function focus(input: HTMLInputElement): void {
  input.focus();
  expect(document.activeElement).toBe(input);
}

function mountSection(query: string, category: CategoryFilter = "All") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  live = { root, container };

  const onOpen = vi.fn<(path: string) => void>();
  let props: SectionProps = { query, category, onOpen };

  const render = () => {
    act(() => {
      root.render(
        <HomeToolsSection
          query={props.query}
          onQueryChange={() => {}}
          category={props.category}
          onCategory={() => {}}
          onOpen={props.onOpen}
        />,
      );
    });
  };

  render();

  return {
    container,
    onOpen,
    input: () => searchInput(container),
    cards: () => toolCards(container),
    active: () => activeCards(container),
    rerender: (next: Partial<Pick<SectionProps, "query" | "category">>) => {
      props = { ...props, ...next };
      render();
    },
  };
}

function toolName(card: HTMLButtonElement): string {
  return card.querySelector(".tool-card__name")?.textContent ?? "";
}

function toolPath(card: HTMLButtonElement): string {
  const tool = TOOLS.find((entry) => entry.name === toolName(card));
  if (!tool) throw new Error(`no registry entry for ${toolName(card)}`);
  return tool.path;
}

describe("HomeToolsSection keyboard navigation", () => {
  it("HS-NAV-ARROWS: Down and Up move through the filtered results and keep focus in the search input", () => {
    const { container } = mountSection("pdf");
    const input = searchInput(container);
    const cards = toolCards(container);
    focus(input);

    expect(cards.length).toBeGreaterThan(2);

    press(input, "ArrowDown");
    expect(activeCards(container)).toEqual([cards[0]]);
    expect(cards[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(cards[0].id);
    expect(document.activeElement).toBe(input);

    press(input, "ArrowDown");
    expect(activeCards(container)).toEqual([cards[1]]);
    expect(document.activeElement).toBe(input);

    press(input, "ArrowUp");
    expect(activeCards(container)).toEqual([cards[0]]);
    expect(document.activeElement).toBe(input);
  });

  it("HS-NAV-BOUNDS: Up from no selection picks the last result, while both edges clamp", () => {
    const { container } = mountSection("pdf");
    const input = searchInput(container);
    const cards = toolCards(container);
    focus(input);

    press(input, "ArrowUp");
    expect(activeCards(container)).toEqual([cards[cards.length - 1]]);

    press(input, "ArrowDown");
    expect(activeCards(container)).toEqual([cards[cards.length - 1]]);

    for (let index = 0; index < cards.length; index += 1) {
      press(input, "ArrowUp");
    }
    expect(activeCards(container)).toEqual([cards[0]]);

    press(input, "ArrowUp");
    expect(activeCards(container)).toEqual([cards[0]]);
  });

  it("HS-NAV-ENTER: Enter opens the active result and does nothing before a result is active", () => {
    const { container, onOpen } = mountSection("docx");
    const input = searchInput(container);
    focus(input);

    press(input, "Enter");
    expect(onOpen).not.toHaveBeenCalled();

    press(input, "ArrowDown");
    const active = activeCards(container)[0];
    expect(active).toBeDefined();

    press(input, "Enter");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(toolPath(active));
  });

  it("HS-NAV-EMPTY: arrows and Enter are safe when no tool matches", () => {
    const { container, onOpen } = mountSection("zzzxxyyzz");
    const input = searchInput(container);
    focus(input);

    expect(toolCards(container)).toEqual([]);

    press(input, "ArrowDown");
    press(input, "ArrowUp");
    press(input, "Enter");

    expect(activeCards(container)).toEqual([]);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("HS-NAV-RESET-QUERY: changing the query clears the active result", () => {
    const { container, rerender } = mountSection("pdf");
    const input = searchInput(container);
    focus(input);

    press(input, "ArrowDown");
    press(input, "ArrowDown");
    expect(activeCards(container)).toHaveLength(1);

    rerender({ query: "compress" });

    expect(document.activeElement).toBe(input);
    expect(activeCards(container)).toEqual([]);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    press(input, "ArrowDown");
    expect(activeCards(container)).toEqual([toolCards(container)[0]]);
  });

  it("HS-NAV-RESET-CATEGORY: changing the category filters the results and clears the active result", () => {
    const { container, onOpen, rerender } = mountSection("", "All");
    const input = searchInput(container);
    focus(input);

    press(input, "ArrowDown");
    expect(activeCards(container)).toHaveLength(1);

    rerender({ category: "Convert" });

    const cards = toolCards(container);
    expect(cards.length).toBeGreaterThan(0);
    expect(activeCards(container)).toEqual([]);

    press(input, "ArrowDown");
    expect(activeCards(container)).toEqual([cards[0]]);

    press(input, "Enter");
    expect(onOpen).toHaveBeenCalledWith(toolPath(cards[0]));
  });

  it("HS-NAV-MOUSE: clicking a result still opens it", () => {
    const { container, onOpen } = mountSection("docx");
    const card = toolCards(container)[0];

    act(() => {
      card.click();
    });

    expect(onOpen).toHaveBeenCalledWith(toolPath(card));
  });
});
