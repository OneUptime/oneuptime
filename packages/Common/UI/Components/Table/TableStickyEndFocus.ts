/*
 * A FOCUSED CELL IS NEVER UNDER THE STICKY ACTIONS COLUMN.
 *
 * A table wider than its card scrolls sideways, and its Actions column - a
 * row's View and ⋯ - sticks at the card's end edge over the cells passing
 * under it (TableLayout). When the keyboard moves on to something in a cell
 * - a pill that says why (ExplainedPill: "Never reminds"), a link, a switch
 * - the browser scrolls the row only as far as the box's own edge: the end
 * of what took the focus came to rest under the stuck column, its focus
 * ring and its words hidden. CSS's scroll-padding does not keep Chrome's
 * sequential focus scroll clear of it either.
 *
 * So the table scrolls the rest of the way itself, once the browser has
 * scrolled: when what took the focus runs under its row's stuck cell, the
 * rows scroll on until it ends a little short of it - or, when it is wider
 * than the room beside the column, until it starts at the box's start edge.
 * Right to left the column is stuck at the left edge, and the rows scroll
 * the other way.
 *
 * React-free on purpose, like TableLayout: App's tests may import it.
 */

// The stuck Actions cells (TableRow's and TableHeader's) carry this.
export const TABLE_STICKY_END_ATTRIBUTE: string = "data-sticky-end";

// How far short of the stuck column what took the focus is left to end.
export const TABLE_STICKY_END_FOCUS_GAP_IN_PX: number = 12;

export interface HorizontalBox {
  left: number;
  right: number;
}

/*
 * How far the rows must scroll (scrollLeft, in pixels: more is further
 * right) for `target` to clear the stuck column `stickyEnd` inside the
 * scroll box `box`. Zero when it is already clear.
 */
export const getStickyEndScrollDelta: (data: {
  target: HorizontalBox;
  stickyEnd: HorizontalBox;
  box: HorizontalBox;
  isRightToLeft: boolean;
  gap?: number | undefined;
}) => number = (data: {
  target: HorizontalBox;
  stickyEnd: HorizontalBox;
  box: HorizontalBox;
  isRightToLeft: boolean;
  gap?: number | undefined;
}): number => {
  const gap: number = data.gap ?? TABLE_STICKY_END_FOCUS_GAP_IN_PX;

  if (!data.isRightToLeft) {
    // The column is stuck at the right: the room is from the box's left.
    const overlap: number = data.target.right - data.stickyEnd.left;

    if (overlap <= 0) {
      return 0;
    }

    const room: number = data.stickyEnd.left - data.box.left;
    const width: number = data.target.right - data.target.left;

    // Too wide for the room: its start, at the box's start edge.
    if (width + gap > room) {
      return data.target.left - data.box.left;
    }

    return Math.ceil(overlap + gap);
  }

  // Right to left the column is stuck at the left, the room from the right.
  const overlap: number = data.stickyEnd.right - data.target.left;

  if (overlap <= 0) {
    return 0;
  }

  const room: number = data.box.right - data.stickyEnd.right;
  const width: number = data.target.right - data.target.left;

  // Too wide for the room: its start - its right end - at the box's right.
  if (width + gap > room) {
    return data.target.right - data.box.right;
  }

  return -Math.ceil(overlap + gap);
};

/*
 * The stuck Actions cell of the row (or header row) `element` is in, or
 * null when there is none, or when `element` is inside it - the column's
 * own View and ⋯ are always in sight.
 */
export const getStickyEndCellOf: (element: Element) => Element | null = (
  element: Element,
): Element | null => {
  if (element.closest(`[${TABLE_STICKY_END_ATTRIBUTE}]`)) {
    return null;
  }

  const row: Element | null = element.closest("tr");

  if (!row) {
    return null;
  }

  return (
    Array.from(row.children).find((cell: Element): boolean => {
      return cell.hasAttribute(TABLE_STICKY_END_ATTRIBUTE);
    }) || null
  );
};

/*
 * Scrolls `box` so that `target` - what just took the focus inside it - is
 * not under its row's stuck Actions cell. Returns how far it scrolled.
 */
export const revealFromStickyEnd: (data: {
  box: HTMLElement;
  target: Element;
}) => number = (data: { box: HTMLElement; target: Element }): number => {
  if (!data.box.contains(data.target) || data.target === data.box) {
    return 0;
  }

  const stickyEnd: Element | null = getStickyEndCellOf(data.target);

  if (!stickyEnd) {
    return 0;
  }

  const isRightToLeft: boolean =
    typeof window !== "undefined" && window.getComputedStyle
      ? window.getComputedStyle(data.box).direction === "rtl"
      : false;

  const delta: number = getStickyEndScrollDelta({
    target: data.target.getBoundingClientRect(),
    stickyEnd: stickyEnd.getBoundingClientRect(),
    box: data.box.getBoundingClientRect(),
    isRightToLeft: isRightToLeft,
  });

  if (delta !== 0) {
    data.box.scrollLeft = data.box.scrollLeft + delta;
  }

  return delta;
};
