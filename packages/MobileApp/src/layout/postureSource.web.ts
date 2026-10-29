import type { FoldReport, PostureSource, WindowFold } from "./windowPosture";

/*
 * How the window folds, as a browser reports it: the Viewport Segments API
 * (window.viewport.segments), which Chromium fills from the same folding
 * features Android apps read. A viewport that a fold or a hinge splits has a
 * segment on each side of it; one that nothing splits has a single segment.
 * A browser without the API - most of them today - is no source at all, and
 * every window keeps the layout its size gives it.
 *
 * The browser reports segments only where the fold splits the viewport, so
 * every fold found here is a separating one. Chromium's DevTools emulate one
 * (Emulation.setDeviceMetricsOverride with a displayFeature), which is how
 * the browser checks in tests/ui put the app into book and tabletop postures.
 */

/** A segment, as the browser hands it over (a DOMRect). */
export interface ViewportSegment {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MediaQueryListLike {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

/** What the source needs of a browser window; a test hands it a stand-in. */
export interface PostureWindow {
  innerWidth: number;
  innerHeight: number;
  viewport?: { segments?: ArrayLike<ViewportSegment> | null } | null;
  addEventListener: (type: "resize", listener: () => void) => void;
  removeEventListener: (type: "resize", listener: () => void) => void;
  matchMedia?: (query: string) => MediaQueryListLike;
}

/*
 * The segment media queries change when a fold starts or stops splitting the
 * viewport, which fires no resize event of its own.
 */
const SEGMENT_QUERIES: ReadonlyArray<string> = [
  "(horizontal-viewport-segments: 2)",
  "(vertical-viewport-segments: 2)",
];

// Segments a fraction of a point apart still meet; browsers round them.
const EDGE_TOLERANCE: number = 0.5;

function isUsableSegment(segment: ViewportSegment | undefined): boolean {
  return (
    Boolean(segment) &&
    Number.isFinite(segment!.x) &&
    Number.isFinite(segment!.y) &&
    Number.isFinite(segment!.width) &&
    Number.isFinite(segment!.height) &&
    segment!.width > 0 &&
    segment!.height > 0
  );
}

/**
 * The folds between a viewport's segments: wherever one segment ends and the
 * next begins, beside it (a fold running top to bottom) or below it (a fold
 * running side to side), the gap between them is the fold. The segments are
 * read from the top left, whatever order the browser lists them in.
 */
export function foldsFromSegments(
  segments: ReadonlyArray<ViewportSegment>,
  windowWidth: number,
  windowHeight: number,
): Array<WindowFold> {
  const usable: Array<ViewportSegment> = segments
    .filter(isUsableSegment)
    .sort((a: ViewportSegment, b: ViewportSegment): number => {
      return a.y - b.y || a.x - b.x;
    });
  const folds: Array<WindowFold> = [];

  for (let index: number = 0; index < usable.length; index += 1) {
    const current: ViewportSegment = usable[index]!;
    for (const next of usable.slice(index + 1)) {
      const currentRight: number = current.x + current.width;
      const currentBottom: number = current.y + current.height;
      const besideIt: boolean =
        next.x >= currentRight - EDGE_TOLERANCE &&
        next.y < currentBottom &&
        next.y + next.height > current.y;
      const belowIt: boolean =
        next.y >= currentBottom - EDGE_TOLERANCE &&
        next.x < currentRight &&
        next.x + next.width > current.x;

      if (besideIt) {
        folds.push({
          x: currentRight,
          y: 0,
          width: Math.max(0, next.x - currentRight),
          height: windowHeight,
          orientation: "vertical",
          separating: true,
        });
      } else if (belowIt) {
        folds.push({
          x: 0,
          y: currentBottom,
          width: windowWidth,
          height: Math.max(0, next.y - currentBottom),
          orientation: "horizontal",
          separating: true,
        });
      }
    }
  }

  return folds;
}

function readSegments(win: PostureWindow): Array<ViewportSegment> | null {
  const segments: ArrayLike<ViewportSegment> | null | undefined =
    win.viewport?.segments;
  if (!segments || typeof segments.length !== "number") {
    return null;
  }
  return Array.from(segments);
}

/** A posture source over a browser window, or null where the browser has no segments. */
export function createViewportSegmentsSource(
  win: PostureWindow | undefined,
): PostureSource | null {
  if (!win || readSegments(win) === null) {
    return null;
  }

  const getCurrent: () => FoldReport | null = (): FoldReport | null => {
    const segments: Array<ViewportSegment> | null = readSegments(win);
    if (segments === null) {
      return null;
    }
    return {
      windowWidth: win.innerWidth,
      windowHeight: win.innerHeight,
      folds: foldsFromSegments(segments, win.innerWidth, win.innerHeight),
    };
  };

  return {
    getCurrent,
    subscribe: (
      listener: (report: FoldReport | null) => void,
    ): (() => void) => {
      const onChange: () => void = (): void => {
        listener(getCurrent());
      };
      win.addEventListener("resize", onChange);
      const queries: Array<MediaQueryListLike> = win.matchMedia
        ? SEGMENT_QUERIES.map((query: string): MediaQueryListLike => {
            return win.matchMedia!(query);
          })
        : [];
      for (const query of queries) {
        query.addEventListener?.("change", onChange);
      }
      return (): void => {
        win.removeEventListener("resize", onChange);
        for (const query of queries) {
          query.removeEventListener?.("change", onChange);
        }
      };
    },
  };
}

/** The platform's posture source: the browser's segments, where it has them. */
export function getPlatformPostureSource(): PostureSource | null {
  return createViewportSegmentsSource(
    typeof window === "undefined"
      ? undefined
      : (window as unknown as PostureWindow),
  );
}
