import type { WindowLayout } from "./windowLayout";

/*
 * A one-pane screen - Home, Settings - half open on a table.
 *
 * A list and its detail already take a half each when a foldable is half
 * closed on a table (windowLayout.ts, the "stacked" panes): the detail stands
 * up above the fold to be read, the list lies below it to be tapped. A screen
 * with no list beside it used to scroll straight across the crease, with a
 * card or a row lying in it as often as not. Such a screen splits there
 * instead: the part worth reading from across the table above the fold, the
 * rows to tap below it, each scrolling on its own, and the same band kept
 * clear around the crease as between two panes. Material's tabletop guidance
 * says the same (content up, controls down), and so does Apple's for the
 * iPhone Duo (the top region for content seen at a distance, the bottom one
 * for controls).
 *
 * Everywhere else - flat, a book, a window that does not fold, a posture
 * nothing reports - the screen is the one scroll it always was.
 */

/** Where a tabletop fold splits a one-pane screen, in points. */
export interface FoldSplit {
  /** From the screen's top - below its bar - to the band around the fold. */
  aboveHeight: number;
  /** The band kept clear around the fold. */
  gap: number;
  /** From the band to the window's bottom edge, where the tab bar floats. */
  belowHeight: number;
}

/*
 * The least room above the fold worth a part of its own: a heading and a card.
 * A window whose bar takes more than that (an outsized text size on a small
 * foldable) keeps its one scroll.
 */
export const MIN_ABOVE_FOLD_HEIGHT: number = 160;

export type FoldSplitLayout = Pick<
  WindowLayout,
  "paneArrangement" | "detailPaneHeight" | "listPaneHeight" | "paneGap"
>;

/**
 * How a tabletop fold splits a one-pane screen whose top is `screenTop`
 * points below the window's top (the height of the bar above it), or null
 * where the screen stays one scroll.
 */
export function getFoldSplit(
  layout: FoldSplitLayout,
  screenTop: number,
): FoldSplit | null {
  if (layout.paneArrangement !== "stacked") {
    return null;
  }

  const top: number =
    Number.isFinite(screenTop) && screenTop > 0 ? screenTop : 0;
  const aboveHeight: number = layout.detailPaneHeight - top;

  if (!(aboveHeight >= MIN_ABOVE_FOLD_HEIGHT) || !(layout.listPaneHeight > 0)) {
    return null;
  }

  return {
    aboveHeight,
    gap: layout.paneGap,
    belowHeight: layout.listPaneHeight,
  };
}
