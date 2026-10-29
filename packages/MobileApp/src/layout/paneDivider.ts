import type { ListPaneWidthRange } from "./windowLayout";

/*
 * Where a dragged divider comes to rest.
 *
 * The reader drags the divider between a list and its detail anywhere within
 * the range the layout allows (both panes at least a phone's width). Let go
 * close to where the layout puts it - the fold's line on a foldable lying
 * flat - and it settles exactly there, so the divider is easy to put back on
 * the fold before the phone is half closed again. A screen reader moves it in
 * steps, and a step that would cross that spot stops on it.
 */

/** Let go within this many points of the layout's own position, the divider settles on it. */
export const DIVIDER_SNAP_DISTANCE: number = 16;

/** How far one increment or decrement from a screen reader moves the divider. */
export const DIVIDER_STEP: number = 40;

export function clampListPaneWidth(
  width: number,
  range: ListPaneWidthRange,
): number {
  if (!Number.isFinite(width)) {
    return range.min;
  }
  return Math.min(range.max, Math.max(range.min, width));
}

/** The width a drag that ends here settles on. */
export function snapListPaneWidth(
  width: number,
  range: ListPaneWidthRange,
  defaultWidth: number,
): number {
  const clamped: number = clampListPaneWidth(width, range);
  return Math.abs(clamped - defaultWidth) <= DIVIDER_SNAP_DISTANCE
    ? clampListPaneWidth(defaultWidth, range)
    : Math.round(clamped);
}

/** One screen-reader step wider (1) or narrower (-1). */
export function stepListPaneWidth(
  width: number,
  direction: 1 | -1,
  range: ListPaneWidthRange,
  defaultWidth: number,
): number {
  const next: number = width + direction * DIVIDER_STEP;
  const crossesDefault: boolean =
    direction === 1
      ? width < defaultWidth && next > defaultWidth
      : width > defaultWidth && next < defaultWidth;
  return clampListPaneWidth(crossesDefault ? defaultWidth : next, range);
}

/**
 * What to remember for a divider at rest here: nothing when it is where the
 * layout puts it anyway, so the reader keeps following the layout's rule.
 */
export function toPreferredListPaneWidth(
  width: number,
  defaultWidth: number,
): number | null {
  return Math.abs(width - defaultWidth) < 0.5 ? null : width;
}

/**
 * The share of the pane area the list takes, as a screen reader says it
 * after the handle's name - "List width, 45%" - the way a platform slider
 * says its value.
 */
export function describeListPaneShare(
  width: number,
  contentWidth: number,
): string {
  if (!(contentWidth > 0)) {
    return "";
  }
  const percent: number = Math.round((width / contentWidth) * 100);
  return `${percent}%`;
}
