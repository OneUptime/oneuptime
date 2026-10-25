/*
 * A TELEMETRY PRODUCT'S TAB BAR ON A NARROW SCREEN (Components/Telemetry/
 * NavTabs): the tabs stay on one line, and the line scrolls sideways when
 * they do not fit - Viewer, Insights, AI, Setup Guide and Settings take
 * about 510px in English and 650px in German, and a phone gives them 326.
 * They used to wrap, and Setup Guide (and in German Settings too) went
 * onto a line of its own under the rest.
 *
 * An edge that hides tabs fades out, so a reader sees there is more past
 * it; an edge with nothing behind it stays sharp. Pure and React-free: the
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
 * How far to scroll the lit tab to the middle of the bar, as a phone's
 * scrolling tabs do, so the tabs on either side of it peek past the fades
 * and a reader sees where they are: Viewer and Insights before AI, Setup
 * Guide after it. The browser stops the scroll at either end, so the first
 * tab stays at the start and the last at the end. Added to scrollLeft, it
 * works the same either way the page reads - more to the right is a larger
 * scrollLeft in both. A tab wider than the bar shows its start.
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

  if (tab.right - tab.left >= bar.right - bar.left) {
    return data.isRightToLeft ? tab.right - bar.right : tab.left - bar.left;
  }

  return (tab.left + tab.right) / 2 - (bar.left + bar.right) / 2;
}
