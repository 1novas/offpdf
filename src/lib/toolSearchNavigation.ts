export type ToolSearchDirection = "up" | "down";

/**
 * Returns the next active index for the filtered home-search results.
 *
 * - An empty result list has no active item (-1).
 * - With no current selection, Down selects the first result and Up selects the last.
 * - The first and last results clamp instead of wrapping.
 */
export function nextToolSearchIndex(
  current: number,
  resultCount: number,
  direction: ToolSearchDirection,
): number {
  if (resultCount <= 0) return -1;

  if (current < 0 || current >= resultCount) {
    return direction === "down" ? 0 : resultCount - 1;
  }

  if (direction === "down") return Math.min(current + 1, resultCount - 1);
  return Math.max(current - 1, 0);
}
