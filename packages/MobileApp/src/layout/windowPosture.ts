/*
 * Where the window folds, and how it is held.
 *
 * windowLayout.ts lays every window out from its size alone, and it puts the
 * divider of a list and its detail on the window's centre line, because that
 * is where a book-style foldable's fold usually runs. Only the platform knows
 * for certain where the fold is and whether the phone is half open: Android
 * says so through Jetpack WindowManager (the app's own WindowPosture module,
 * in modules/window-posture), and a browser through the Viewport Segments
 * API. Where nothing says - iOS today, Expo Go, an older build, a browser
 * without the API - the posture is "unknown", and the layout is exactly the
 * one the window would get without any of this.
 *
 * Everything here is pure: a report from the platform in, the posture out.
 */

/** The direction a fold's line runs across the window. */
export type FoldOrientation = "vertical" | "horizontal";

/** A fold - or the hinge between two screens - inside the app's window, in window points. */
export interface WindowFold {
  x: number;
  y: number;
  /** 0 across a seamless fold; the hinge's width where it hides part of the window. */
  width: number;
  height: number;
  /** "vertical" runs top to bottom (a book), "horizontal" side to side (a laptop). */
  orientation: FoldOrientation;
  /**
   * Whether the fold splits the window right now: the phone is half open, or
   * the fold is a hinge between two screens. Content across it is hard to
   * read and to tap.
   */
  separating: boolean;
}

/** What the platform said about the window's folds, for one window size. */
export interface FoldReport {
  /** The window the report describes; a report for another size is stale. */
  windowWidth: number;
  windowHeight: number;
  folds: ReadonlyArray<WindowFold>;
}

/** Where reports come from: the native module, the browser, or a test. */
export interface PostureSource {
  /** The latest report, or null while the platform has said nothing yet. */
  getCurrent: () => FoldReport | null;
  /** Calls back with each new report. Returns the unsubscribe. */
  subscribe: (listener: (report: FoldReport | null) => void) => () => void;
}

/**
 * - "unknown": nothing says where the window folds (no source, no report yet,
 *   or a report for another window size). The layout is today's.
 * - "flat": the window does not fold, or folds flat open, so nothing sits on
 *   a crease and the divider can go anywhere.
 * - "book": a fold runs top to bottom and splits the window.
 * - "tabletop": a fold runs side to side and splits the window, the lower
 *   half resting on a table.
 */
export type PostureKind = "unknown" | "flat" | "book" | "tabletop";

export interface WindowPosture {
  kind: PostureKind;
  /** The fold that splits the window, for "book" and "tabletop"; otherwise null. */
  fold: WindowFold | null;
}

export const UNKNOWN_POSTURE: WindowPosture = Object.freeze({
  kind: "unknown",
  fold: null,
});

/*
 * A report is matched to the window it describes within this many points:
 * the platform and React Native round the same window from pixels, and may
 * do it a fraction apart.
 */
export const WINDOW_MATCH_TOLERANCE: number = 2;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFold(raw: unknown): WindowFold | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record: Record<string, unknown> = raw as Record<string, unknown>;
  const x: number | null = finiteNumber(record["x"]);
  const y: number | null = finiteNumber(record["y"]);
  const width: number | null = finiteNumber(record["width"]);
  const height: number | null = finiteNumber(record["height"]);
  const orientation: unknown = record["orientation"];

  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width < 0 ||
    height < 0 ||
    (orientation !== "vertical" && orientation !== "horizontal")
  ) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    orientation,
    separating: record["separating"] === true,
  };
}

/**
 * Reads a report as the native module or the browser hands it over. Anything
 * malformed is dropped rather than trusted: a report without a usable window
 * size is no report at all, and a fold without usable bounds is left out.
 */
export function parseFoldReport(raw: unknown): FoldReport | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record: Record<string, unknown> = raw as Record<string, unknown>;
  const windowWidth: number | null = finiteNumber(record["windowWidth"]);
  const windowHeight: number | null = finiteNumber(record["windowHeight"]);

  if (
    windowWidth === null ||
    windowHeight === null ||
    windowWidth <= 0 ||
    windowHeight <= 0
  ) {
    return null;
  }

  const rawFolds: unknown = record["folds"];
  const folds: Array<WindowFold> = Array.isArray(rawFolds)
    ? rawFolds
        .map((fold: unknown): WindowFold | null => {
          return readFold(fold);
        })
        .filter((fold: WindowFold | null): fold is WindowFold => {
          return fold !== null;
        })
    : [];

  return { windowWidth, windowHeight, folds };
}

/** Whether a report was made for a window of this size. */
export function reportMatchesWindow(
  report: FoldReport,
  size: { width: number; height: number },
): boolean {
  return (
    Math.abs(report.windowWidth - size.width) <= WINDOW_MATCH_TOLERANCE &&
    Math.abs(report.windowHeight - size.height) <= WINDOW_MATCH_TOLERANCE
  );
}

/*
 * Whether a fold lies across the window, rather than along one of its edges
 * or outside it: a vertical fold must have window on both sides of it, a
 * horizontal one window above and below.
 */
function crossesWindow(
  fold: WindowFold,
  size: { width: number; height: number },
): boolean {
  if (fold.orientation === "vertical") {
    return fold.x > 0 && fold.x + fold.width < size.width;
  }
  return fold.y > 0 && fold.y + fold.height < size.height;
}

/**
 * The posture of a window of this size, from the latest report.
 *
 * A report made for another size says nothing about this window - the
 * platform and React Native learn of a rotation or a resize separately, and
 * either may be a moment behind - so the posture stays unknown until the two
 * agree. The first fold that splits the window decides between a book and a
 * tabletop; a fold that does not split it (a foldable lying flat open) leaves
 * the window flat.
 */
export function getWindowPosture(
  report: FoldReport | null,
  size: { width: number; height: number },
): WindowPosture {
  if (!report || !reportMatchesWindow(report, size)) {
    return UNKNOWN_POSTURE;
  }

  const fold: WindowFold | undefined = report.folds.find(
    (candidate: WindowFold): boolean => {
      return candidate.separating && crossesWindow(candidate, size);
    },
  );

  if (!fold) {
    return { kind: "flat", fold: null };
  }

  return {
    kind: fold.orientation === "vertical" ? "book" : "tabletop",
    fold,
  };
}
