/*
 * Which layout a window gets.
 *
 * Every rule here reads the window the app is drawn in, and nothing else -
 * never the kind of device. A foldable is a phone and a tablet in one hand,
 * and it turns from one into the other while somebody is reading an
 * incident: the cover screen of a Galaxy Z Fold is narrower than most phones
 * (344 points), its inner screen is wider than an iPad held upright
 * (884 x 1104), and the iPhone Duo held open is 951 x 669. Split screen,
 * Slide Over, iPhone Mirroring and Android's desktop windows make any size
 * possible on any device, so "is this a tablet?" has no useful answer.
 *
 * The width breakpoints are Material 3's window size classes - below 600
 * points is compact (a phone held upright, a cover screen, a narrow split),
 * 600 to 839 is medium (a tablet or an unfolded phone held upright), 840 and
 * up is expanded (landscape on either). Apple's size classes line up with
 * them closely enough that one set of rules serves both platforms.
 */

/** The window's safe-area insets, in points. */
export interface LayoutInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export type WidthClass = "compact" | "medium" | "expanded";
export type HeightClass = "compact" | "medium" | "expanded";

/** Where the five destinations are drawn: a bar along the bottom, or a rail down the left. */
export type NavigationPlacement = "bar" | "rail";

/** Material 3's medium and expanded width breakpoints. */
export const MEDIUM_WIDTH: number = 600;
export const EXPANDED_WIDTH: number = 840;

/** Material 3's medium and expanded height breakpoints. */
export const MEDIUM_HEIGHT: number = 480;
export const EXPANDED_HEIGHT: number = 900;

/** The navigation rail's own width, before the left safe-area inset it also covers. */
export const NAVIGATION_RAIL_WIDTH: number = 80;

/*
 * Every screen in the app is designed for a phone held upright, 320 to 430
 * points wide. Two panes are offered only when each of them can be at least
 * a phone's width, so neither ever has to be a squeezed version of itself.
 */
export const MIN_PANE_WIDTH: number = 360;

/*
 * The list pane's width when the panes meet at the window's centre line.
 * On a book-style foldable held open (Galaxy Z Fold, Pixel Fold, iPhone Duo)
 * that line is the fold, so splitting there keeps every card and button off
 * the crease when the phone is half-folded - which is worth a list a few
 * points narrower or wider than ideal.
 */
export const MIN_LIST_PANE_WIDTH: number = 320;
export const MAX_LIST_PANE_WIDTH: number = 440;

/*
 * Anywhere the centre line would make the list too wide (a tablet in
 * landscape, a desktop window), the list takes this share of the content
 * area, within these bounds, and the detail gets the rest.
 */
export const LIST_PANE_SHARE: number = 0.38;
export const PREFERRED_MAX_LIST_PANE_WIDTH: number = 420;

/*
 * Cards and text stop growing here, and the gutters take up the rest, so a
 * line of text stays readable and a button stays a button on a wide window.
 */
export const READABLE_CONTENT_WIDTH: number = 720;

/*
 * A page whose sections can stand side by side (Home) splits into two
 * columns from this width, and its two columns together stop at the wider
 * readable width below - about two phone-width cards and a gap.
 */
export const TWO_COLUMN_MIN_WIDTH: number = 960;
export const TWO_COLUMN_READABLE_WIDTH: number = 1040;

/** The page gutter at phone widths (layout.gutter). */
export const SCREEN_GUTTER: number = 20;

/** Bottom sheets stop at this width and are centred, as Material does on large screens. */
export const SHEET_MAX_WIDTH: number = 640;

export interface WindowLayout {
  /** The window, in points. */
  width: number;
  height: number;
  /** The window's safe-area insets. */
  insets: LayoutInsets;
  widthClass: WidthClass;
  heightClass: HeightClass;
  navigation: NavigationPlacement;
  /** The rail's width including the left inset it covers; 0 with a bar. */
  railWidth: number;
  /** Everything beside the rail: the width screens and panes share. */
  contentWidth: number;
  /** One pane, or a list and its detail side by side. */
  panes: 1 | 2;
  /** The list pane's width; 0 with one pane. */
  listPaneWidth: number;
  /** The detail pane's width, or the whole content width with one pane. */
  detailPaneWidth: number;
  /** Whether the panes meet on the window's centre line, where a fold runs. */
  splitAtCentre: boolean;
}

export const ZERO_INSETS: LayoutInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export function getWidthClass(width: number): WidthClass {
  if (width >= EXPANDED_WIDTH) {
    return "expanded";
  }
  return width >= MEDIUM_WIDTH ? "medium" : "compact";
}

export function getHeightClass(height: number): HeightClass {
  if (height >= EXPANDED_HEIGHT) {
    return "expanded";
  }
  return height >= MEDIUM_HEIGHT ? "medium" : "compact";
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lays out a window.
 *
 * - Two panes from 840 points wide, when both a list and its detail can be at
 *   least a phone's width beside the rail. Below that, one pane.
 * - A rail down the left whenever there are two panes, or the window is at
 *   least 600 points wide and wider than it is tall (a phone in landscape,
 *   the iPhone Duo's cover screen on its side). Otherwise a bar along the
 *   bottom, as on every phone held upright and on a tablet in portrait.
 * - With two panes, the divider sits on the window's centre line whenever
 *   the list fits there - the fold of a book-style foldable - and otherwise
 *   the list takes 38% of the space, between 360 and 420 points.
 */
export function computeWindowLayout(
  size: WindowSize,
  insets: LayoutInsets = ZERO_INSETS,
): WindowLayout {
  const width: number = nonNegative(size.width);
  const height: number = nonNegative(size.height);
  const safeInsets: LayoutInsets = {
    top: nonNegative(insets.top),
    right: nonNegative(insets.right),
    bottom: nonNegative(insets.bottom),
    left: nonNegative(insets.left),
  };

  const railCandidateWidth: number = NAVIGATION_RAIL_WIDTH + safeInsets.left;
  const twoPanes: boolean =
    width >= EXPANDED_WIDTH &&
    width - railCandidateWidth - safeInsets.right >= MIN_PANE_WIDTH * 2;
  const rail: boolean = twoPanes || (width >= MEDIUM_WIDTH && width > height);
  const railWidth: number = rail ? railCandidateWidth : 0;
  const contentWidth: number = Math.max(0, width - railWidth);

  let listPaneWidth: number = 0;
  let splitAtCentre: boolean = false;

  if (twoPanes) {
    const centre: number = width / 2;
    const listAtCentre: number = centre - railWidth;
    const detailAtCentre: number = width - centre - safeInsets.right;

    if (
      listAtCentre >= MIN_LIST_PANE_WIDTH &&
      listAtCentre <= MAX_LIST_PANE_WIDTH &&
      detailAtCentre >= MIN_PANE_WIDTH
    ) {
      listPaneWidth = listAtCentre;
      splitAtCentre = true;
    } else {
      listPaneWidth = clamp(
        Math.round(contentWidth * LIST_PANE_SHARE),
        MIN_PANE_WIDTH,
        PREFERRED_MAX_LIST_PANE_WIDTH,
      );
    }
  }

  return {
    width,
    height,
    insets: safeInsets,
    widthClass: getWidthClass(width),
    heightClass: getHeightClass(height),
    navigation: rail ? "rail" : "bar",
    railWidth,
    contentWidth,
    panes: twoPanes ? 2 : 1,
    listPaneWidth,
    detailPaneWidth: twoPanes ? contentWidth - listPaneWidth : contentWidth,
    splitAtCentre,
  };
}

/**
 * The gutter on each side of a pane's content: the phone gutter, or more
 * once the pane is wider than readable content needs.
 */
export function getReadableGutter(
  availableWidth: number,
  readableWidth: number = READABLE_CONTENT_WIDTH,
): number {
  return Math.max(
    SCREEN_GUTTER,
    (nonNegative(availableWidth) - readableWidth) / 2,
  );
}

/** Whether a pane is wide enough to set a page's sections in two columns. */
export function hasRoomForTwoColumns(pane: PaneGeometry): boolean {
  return (
    nonNegative(pane.width) -
      nonNegative(pane.insetLeft) -
      nonNegative(pane.insetRight) >=
    TWO_COLUMN_MIN_WIDTH
  );
}

/** One pane's geometry: its width, and the window insets that touch its edges. */
export interface PaneGeometry {
  width: number;
  insetLeft: number;
  insetRight: number;
}

export interface ContentGutters {
  paddingLeft: number;
  paddingRight: number;
}

/**
 * The horizontal padding a pane's scrolling content needs: its safe-area
 * edges first, then a gutter that keeps cards and text at a readable width.
 * Safe areas are asymmetric on a foldable (the iPhone Duo's camera sits on
 * one side), so each edge is kept on its own.
 */
export function getContentGutters(
  pane: PaneGeometry,
  readableWidth: number = READABLE_CONTENT_WIDTH,
): ContentGutters {
  const insetLeft: number = nonNegative(pane.insetLeft);
  const insetRight: number = nonNegative(pane.insetRight);
  const gutter: number = getReadableGutter(
    nonNegative(pane.width) - insetLeft - insetRight,
    readableWidth,
  );
  return {
    paddingLeft: insetLeft + gutter,
    paddingRight: insetRight + gutter,
  };
}
