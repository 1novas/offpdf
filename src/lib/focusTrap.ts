/** Elements that can receive keyboard focus inside a dialog, in DOM order. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Index to focus when Tab/Shift+Tab moves from `current` inside a list of
 * `count` focusable elements. `-1` means focus is on the dialog container.
 * Returns `-1` when there is nothing to focus.
 */
export function nextTrapIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}
