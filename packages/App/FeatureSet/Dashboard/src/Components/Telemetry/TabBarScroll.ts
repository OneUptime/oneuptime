/*
 * A TELEMETRY PRODUCT'S TAB BAR ON A NARROW SCREEN (Components/Telemetry/
 * NavTabs): the tabs stay on one line, and the line scrolls sideways when
 * they do not fit - Viewer, Insights, AI, Setup Guide and Settings take
 * about 510px in English and 650px in German, and a phone gives them 326.
 * They used to wrap, and Setup Guide (and in German Settings too) went
 * onto a line of its own under the rest.
 *
 * An edge that hides tabs fades out, so a reader sees there is more past
 * it; an edge with nothing behind it stays sharp. The lit tab is scrolled
 * into view with the next tab peeking past the fade, and no further, so
 * the first tabs stay in sight whenever they can. Pure and React-free: the
 * component measures, this decides, and the tests read it.
 */

// How far past an edge the content must reach before it counts as hidden.
const HIDDEN_EPSILON_PX: number = 1;

// What a scroller measures: element.scrollLeft, scrollWidth, clientWidth.
export interface TabBarScrollMeasure {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  // The page reads right to left (Persian): its tabs start on the right.
  isRightToLeft: boolean;
}

// Which physical edges have tabs out of sight behind them.
export interface TabBarHiddenEdges {
  left: boolean;
  right: boolean;
}

export const NO_HIDDEN_EDGES: TabBarHiddenEdges = { left: false, right: false };

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * The edges with tabs behind them. Left to right, scrollLeft runs from 0
 * (the first tab in view) to the overflow. Right to left it runs from 0
 * (the first tab, on the right, in view) down to minus the overflow, as
 * browsers do it (the CSSOM spec). A scroll past either end - a touch
 * screen's overscroll bounce - reads as that end.
 */
export function getTabBarHiddenEdges(
  measure: TabBarScrollMeasure,
): TabBarHiddenEdges {
  if (
    !isFiniteNumber(measure.scrollLeft) ||
    !isFiniteNumber(measure.scrollWidth) ||
    !isFiniteNumber(measure.clientWidth)
  ) {
    return NO_HIDDEN_EDGES;
  }

  const overflow: number = measure.scrollWidth - measure.clientWidth;

  // Everything fits: nothing to scroll to, no edge fades.
  if (overflow <= HIDDEN_EPSILON_PX) {
    return NO_HIDDEN_EDGES;
  }

  // How far the tabs are scrolled from their start, whatever the direction.
  const fromStart: number = Math.min(
    overflow,
    Math.max(
      0,
      measure.isRightToLeft ? -measure.scrollLeft : measure.scrollLeft,
    ),
  );
  const isStartHidden: boolean = fromStart > HIDDEN_EPSILON_PX;
  const isEndHidden: boolean = fromStart < overflow - HIDDEN_EPSILON_PX;

  return measure.isRightToLeft
    ? { left: isEndHidden, right: isStartHidden }
    : { left: isStartHidden, right: isEndHidden };
}

/*
 * The fade for the hidden edges: a mask that takes the last 1.5rem of a
 * hidden side to transparent. Colour-free, so it fades the tabs into
 * whatever the card is, light or dark.
 */
export const TAB_BAR_FADE_CLASS_NAMES: Readonly<{
  both: string;
  left: string;
  right: string;
}> = {
  both: "[-webkit-mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)] [mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]",
  left: "[-webkit-mask-image:linear-gradient(to_right,transparent,black_1.5rem)] [mask-image:linear-gradient(to_right,transparent,black_1.5rem)]",
  right:
    "[-webkit-mask-image:linear-gradient(to_left,transparent,black_1.5rem)] [mask-image:linear-gradient(to_left,transparent,black_1.5rem)]",
};

export function getTabBarFadeClassName(edges: TabBarHiddenEdges): string {
  if (edges.left && edges.right) {
    return TAB_BAR_FADE_CLASS_NAMES.both;
  }

  if (edges.left) {
    return TAB_BAR_FADE_CLASS_NAMES.left;
  }

  if (edges.right) {
    return TAB_BAR_FADE_CLASS_NAMES.right;
  }

  return "";
}

// A tab's place, measured against the scroller's, along the line.
export interface TabBarBox {
  left: number;
  right: number;
}

/*
 * How much of the bar is kept beside the lit tab when it is scrolled into
 * view (3rem): the edge's 1.5rem fade, the next tab's own padding, and the
 * start of its name - so a reader sees there is more past the edge. The
 * scroller keeps the same room for a tab the keyboard reaches
 * (TAB_BAR_SCROLL_PADDING_CLASS_NAME), so a focused tab never sits under
 * the fade.
 */
export const TAB_BAR_PEEK_PX: number = 48;

export const TAB_BAR_SCROLL_PADDING_CLASS_NAME: string = "scroll-px-12";

/*
 * How far to scroll the bar so the lit tab is in view, with room beside it
 * for the next tab to peek past the fade - and no further: a lit tab that
 * is already in view stays where it is. The first tabs (Viewer, or
 * Exceptions with its count) are what a reader looks for, so they stay in
 * sight whenever the lit tab leaves room for them. Bringing the lit tab to
 * the middle instead hid them whole behind the fade whenever the widths
 * fell that way: German Exceptions on a 390px phone showed no Exceptions
 * tab at all.
 *
 * The browser stops the scroll at either end, so the first tab stays at
 * the start and the last at the end. Added to scrollLeft, it works the
 * same either way the page reads - more to the right is a larger
 * scrollLeft in both. A tab too wide for the room keeps what it can of it,
 * and one wider than the bar shows its start.
 */
export function getTabBarScrollDelta(data: {
  tab: TabBarBox;
  bar: TabBarBox;
  isRightToLeft: boolean;
}): number {
  const { tab, bar } = data;

  if (
    ![tab.left, tab.right, bar.left, bar.right].every(isFiniteNumber) ||
    bar.right - bar.left <= 0 ||
    tab.right - tab.left <= 0
  ) {
    return 0;
  }

  // The bar's room on each side of the lit tab, were it in the middle.
  const room: number = (bar.right - bar.left - (tab.right - tab.left)) / 2;

  if (room <= 0) {
    return data.isRightToLeft ? tab.right - bar.right : tab.left - bar.left;
  }

  const peek: number = Math.min(TAB_BAR_PEEK_PX, room);

  // Under the end edge's fade, or past it: bring it in, its next tab peeking.
  if (tab.right > bar.right - peek) {
    return tab.right - (bar.right - peek);
  }

  // The same at the start edge.
  if (tab.left < bar.left + peek) {
    return tab.left - (bar.left + peek);
  }

  return 0;
}
