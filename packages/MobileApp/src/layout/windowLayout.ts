import {
  UNKNOWN_POSTURE,
  type PostureKind,
  type WindowFold,
  type WindowPosture,
} from "./windowPosture";

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
 *
 * Where the platform also says how the window folds (windowPosture.ts), the
 * fold and the way the phone is held refine those rules; where it does not,
 * nothing changes.
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

/**
 * How two panes sit: "row" puts the list beside its detail; "stacked" is the
 * tabletop layout, the detail above the fold and the list below it.
 */
export type PaneArrangement = "row" | "stacked";

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

/*
 * Half open on a table, a foldable's upper half stands up to be read and its
 * lower half lies flat to be tapped. Each half takes a pane of its own only
 * when it has room for a header and a few rows; on a smaller window the
 * posture changes nothing.
 */
export const MIN_STACKED_PANE_HEIGHT: number = 280;

/*
 * The band kept clear around a seamless tabletop fold, so neither the list's
 * header nor the detail's last line sits on the crease. A hinge that hides
 * part of the window keeps its own band, if that is wider.
 */
export const TABLETOP_FOLD_GAP: number = 24;

export interface ListPaneWidthRange {
  min: number;
  max: number;
}

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
  /** One pane, or a list and its detail on screen together. */
  panes: 1 | 2;
  /** The list pane's width; 0 with one pane. */
  listPaneWidth: number;
  /** The detail pane's width, or the whole content width with one pane. */
  detailPaneWidth: number;
  /** Whether the panes meet on the window's centre line, where a fold runs. */
  splitAtCentre: boolean;
  /** "row": the list beside its detail; "stacked": tabletop, the detail above the fold. */
  paneArrangement: PaneArrangement;
  /**
   * Each pane's height: the window's for panes in a row, and for stacked
   * panes the detail's from the top of the window to the fold's band and the
   * list's from the band to the bottom. The list's is 0 with one pane.
   */
  detailPaneHeight: number;
  listPaneHeight: number;
  /**
   * The space between the two panes: a hinge that hides part of the window,
   * or the band kept clear around a tabletop fold. 0 where the panes meet.
   */
  paneGap: number;
  /** Whether the panes meet on a fold that splits the window (half open). */
  splitAtFold: boolean;
  /** The posture the window was laid out for (windowPosture.ts). */
  posture: PostureKind;
  /**
   * The list widths the reader may drag the divider between, or null where
   * it stays put: one pane, stacked panes, a fold splitting the window, and
   * every window whose posture nothing reports - without knowing where a
   * hinge is, a dragged divider could leave a pane across it.
   */
  listPaneWidthRange: ListPaneWidthRange | null;
  /** The list's width by the rules above, before the reader moves the divider. */
  defaultListPaneWidth: number;
}

export interface WindowLayoutOptions {
  /** Where the window folds and how it is held; unknown unless the platform says. */
  posture?: WindowPosture;
  /** The list width the reader chose by dragging the divider, if any. */
  preferredListPaneWidth?: number | null;
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

interface StackedPanes {
  detailPaneHeight: number;
  paneGap: number;
  listPaneHeight: number;
}

/*
 * Tabletop: the detail above the fold and the list below it, each clear of
 * the fold's band - when the window folds side to side and both halves have
 * room for a pane.
 */
function getStackedPanes(
  posture: WindowPosture,
  width: number,
  height: number,
): StackedPanes | null {
  const fold: WindowFold | null = posture.fold;
  if (posture.kind !== "tabletop" || !fold || width < MIN_LIST_PANE_WIDTH) {
    return null;
  }

  const paneGap: number = Math.max(fold.height, TABLETOP_FOLD_GAP);
  const foldMiddle: number = fold.y + fold.height / 2;
  const detailPaneHeight: number = foldMiddle - paneGap / 2;
  const listPaneHeight: number = height - (foldMiddle + paneGap / 2);

  if (
    detailPaneHeight < MIN_STACKED_PANE_HEIGHT ||
    listPaneHeight < MIN_STACKED_PANE_HEIGHT
  ) {
    return null;
  }

  return { detailPaneHeight, paneGap, listPaneHeight };
}

function isUsableWidth(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
 *
 * Where the platform reports how the window folds (options.posture):
 *
 * - Half open like a book, the panes meet on the fold itself, wherever it
 *   runs, and the divider stays there: no card or button crosses the crease.
 * - Half open on a table, the detail takes the upper half and the list the
 *   lower half, with the bar along the bottom, under the reader's hand.
 * - Lying flat, or on a window that does not fold, the reader may drag the
 *   divider (options.preferredListPaneWidth) within the widths both panes
 *   need.
 *
 * Where nothing reports a posture, every window is laid out by the first
 * three rules alone, exactly as before.
 */
export function computeWindowLayout(
  size: WindowSize,
  insets: LayoutInsets = ZERO_INSETS,
  options: WindowLayoutOptions = {},
): WindowLayout {
  const width: number = nonNegative(size.width);
  const height: number = nonNegative(size.height);
  const safeInsets: LayoutInsets = {
    top: nonNegative(insets.top),
    right: nonNegative(insets.right),
    bottom: nonNegative(insets.bottom),
    left: nonNegative(insets.left),
  };
  const posture: WindowPosture = options.posture ?? UNKNOWN_POSTURE;

  const stacked: StackedPanes | null = getStackedPanes(posture, width, height);
  if (stacked) {
    return {
      width,
      height,
      insets: safeInsets,
      widthClass: getWidthClass(width),
      heightClass: getHeightClass(height),
      navigation: "bar",
      railWidth: 0,
      contentWidth: width,
      panes: 2,
      listPaneWidth: width,
      detailPaneWidth: width,
      splitAtCentre: false,
      paneArrangement: "stacked",
      detailPaneHeight: stacked.detailPaneHeight,
      listPaneHeight: stacked.listPaneHeight,
      paneGap: stacked.paneGap,
      splitAtFold: true,
      posture: posture.kind,
      listPaneWidthRange: null,
      defaultListPaneWidth: width,
    };
  }

  const railCandidateWidth: number = NAVIGATION_RAIL_WIDTH + safeInsets.left;
  const twoPanes: boolean =
    width >= EXPANDED_WIDTH &&
    width - railCandidateWidth - safeInsets.right >= MIN_PANE_WIDTH * 2;
  const rail: boolean = twoPanes || (width >= MEDIUM_WIDTH && width > height);
  const railWidth: number = rail ? railCandidateWidth : 0;
  const contentWidth: number = Math.max(0, width - railWidth);

  let defaultListPaneWidth: number = 0;
  let listPaneWidth: number = 0;
  let splitAtCentre: boolean = false;
  let splitAtFold: boolean = false;
  let paneGap: number = 0;
  let listPaneWidthRange: ListPaneWidthRange | null = null;

  if (twoPanes) {
    const centre: number = width / 2;
    const listAtCentre: number = centre - railWidth;
    const detailAtCentre: number = width - centre - safeInsets.right;

    if (
      listAtCentre >= MIN_LIST_PANE_WIDTH &&
      listAtCentre <= MAX_LIST_PANE_WIDTH &&
      detailAtCentre >= MIN_PANE_WIDTH
    ) {
      defaultListPaneWidth = listAtCentre;
      splitAtCentre = true;
    } else {
      defaultListPaneWidth = clamp(
        Math.round(contentWidth * LIST_PANE_SHARE),
        MIN_PANE_WIDTH,
        PREFERRED_MAX_LIST_PANE_WIDTH,
      );
    }
    listPaneWidth = defaultListPaneWidth;

    const fold: WindowFold | null = posture.fold;
    if (posture.kind === "book" && fold) {
      /*
       * The panes meet on the fold wherever the window has it - the centre of
       * a phone held open, or anywhere in a window that spans the fold in
       * split screen - as long as each side has room for its pane. A hinge
       * that hides part of the window stays the space between them.
       */
      const listAtFold: number = fold.x - railWidth;
      const detailAtFold: number =
        width - (fold.x + fold.width) - safeInsets.right;
      if (listAtFold >= MIN_LIST_PANE_WIDTH && detailAtFold >= MIN_PANE_WIDTH) {
        listPaneWidth = listAtFold;
        paneGap = fold.width;
        splitAtFold = true;
        splitAtCentre =
          Math.abs(railWidth + listAtFold + fold.width / 2 - centre) < 0.5;
      }
    } else if (posture.kind === "flat") {
      listPaneWidthRange = {
        min: MIN_LIST_PANE_WIDTH,
        max: contentWidth - safeInsets.right - MIN_PANE_WIDTH,
      };
      if (isUsableWidth(options.preferredListPaneWidth)) {
        listPaneWidth = clamp(
          options.preferredListPaneWidth,
          listPaneWidthRange.min,
          listPaneWidthRange.max,
        );
        splitAtCentre = Math.abs(railWidth + listPaneWidth - centre) < 0.5;
      }
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
    detailPaneWidth: twoPanes
      ? contentWidth - listPaneWidth - paneGap
      : contentWidth,
    splitAtCentre,
    paneArrangement: "row",
    detailPaneHeight: height,
    listPaneHeight: twoPanes ? height : 0,
    paneGap,
    splitAtFold,
    posture: posture.kind,
    listPaneWidthRange,
    defaultListPaneWidth,
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
