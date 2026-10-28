import { describe, expect, jest, test } from "@jest/globals";
import {
  createViewportSegmentsSource,
  foldsFromSegments,
  type PostureWindow,
  type ViewportSegment,
} from "./postureSource.web";
import type { FoldReport, PostureSource } from "./windowPosture";

/*
 * The web build's source: the browser's viewport segments. tests/ui drives
 * the same code in a real Chromium, with DevTools emulating the fold; here
 * the window is a stand-in, so every branch can be reached - including the
 * browsers that have no segments at all, which are no source.
 */

interface FakeWindow extends PostureWindow {
  setSegments: (segments: Array<ViewportSegment> | null) => void;
  resize: (width: number, height: number) => void;
  fireQuery: (query: string) => void;
  listenerCounts: () => { resize: number; queries: number };
}

function fakeWindow(
  width: number,
  height: number,
  segments: Array<ViewportSegment> | null | undefined,
  { withMatchMedia = true }: { withMatchMedia?: boolean } = {},
): FakeWindow {
  const resizeListeners: Set<() => void> = new Set();
  const queryListeners: Map<string, Set<() => void>> = new Map();
  const viewport: { segments: Array<ViewportSegment> | null } | undefined =
    segments === undefined ? undefined : { segments };

  const win: FakeWindow = {
    innerWidth: width,
    innerHeight: height,
    viewport,
    addEventListener: (_type: "resize", listener: () => void): void => {
      resizeListeners.add(listener);
    },
    removeEventListener: (_type: "resize", listener: () => void): void => {
      resizeListeners.delete(listener);
    },
    setSegments: (next: Array<ViewportSegment> | null): void => {
      if (viewport) {
        viewport.segments = next;
      }
    },
    resize: (nextWidth: number, nextHeight: number): void => {
      win.innerWidth = nextWidth;
      win.innerHeight = nextHeight;
      for (const listener of Array.from(resizeListeners)) {
        listener();
      }
    },
    fireQuery: (query: string): void => {
      for (const listener of Array.from(queryListeners.get(query) ?? [])) {
        listener();
      }
    },
    listenerCounts: (): { resize: number; queries: number } => {
      return {
        resize: resizeListeners.size,
        queries: Array.from(queryListeners.values()).reduce(
          (total: number, set: Set<() => void>): number => {
            return total + set.size;
          },
          0,
        ),
      };
    },
  };

  if (withMatchMedia) {
    win.matchMedia = (query: string) => {
      const set: Set<() => void> = queryListeners.get(query) ?? new Set();
      queryListeners.set(query, set);
      return {
        addEventListener: (_type: "change", listener: () => void): void => {
          set.add(listener);
        },
        removeEventListener: (_type: "change", listener: () => void): void => {
          set.delete(listener);
        },
      };
    };
  }

  return win;
}

const WHOLE_INNER_SCREEN: Array<ViewportSegment> = [
  { x: 0, y: 0, width: 884, height: 1104 },
];
// Chromium's two segments for a fold down the middle (DevTools, displayFeature vertical at 442).
const BOOK_SEGMENTS: Array<ViewportSegment> = [
  { x: 0, y: 0, width: 442, height: 1104 },
  { x: 442, y: 0, width: 442, height: 1104 },
];
// And for a fold across the middle of the inner screen on its side, with a 40-point mask.
const TABLETOP_SEGMENTS: Array<ViewportSegment> = [
  { x: 0, y: 0, width: 1104, height: 422 },
  { x: 0, y: 462, width: 1104, height: 422 },
];

describe("foldsFromSegments: the fold is the gap between two segments", () => {
  test("one segment is a window nothing splits", () => {
    expect(foldsFromSegments(WHOLE_INNER_SCREEN, 884, 1104)).toEqual([]);
    expect(foldsFromSegments([], 884, 1104)).toEqual([]);
  });

  test("segments side by side meet on a fold running top to bottom", () => {
    expect(foldsFromSegments(BOOK_SEGMENTS, 884, 1104)).toEqual([
      {
        x: 442,
        y: 0,
        width: 0,
        height: 1104,
        orientation: "vertical",
        separating: true,
      },
    ]);
  });

  test("segments one above the other meet on a fold running side to side, mask and all", () => {
    expect(foldsFromSegments(TABLETOP_SEGMENTS, 1104, 884)).toEqual([
      {
        x: 0,
        y: 422,
        width: 1104,
        height: 40,
        orientation: "horizontal",
        separating: true,
      },
    ]);
  });

  test("the order the browser lists them in does not matter", () => {
    expect(
      foldsFromSegments([BOOK_SEGMENTS[1]!, BOOK_SEGMENTS[0]!], 884, 1104),
    ).toEqual([
      {
        x: 442,
        y: 0,
        width: 0,
        height: 1104,
        orientation: "vertical",
        separating: true,
      },
    ]);
  });

  test("segments a rounding apart still meet", () => {
    const folds: ReturnType<typeof foldsFromSegments> = foldsFromSegments(
      [
        { x: 0, y: 0, width: 475.6, height: 669 },
        { x: 475.4, y: 0, width: 475.6, height: 669 },
      ],
      951,
      669,
    );

    expect(folds).toHaveLength(1);
    expect(folds[0]!.orientation).toBe("vertical");
    expect(folds[0]!.width).toBe(0);
  });

  test("segments that are not rectangles are left out", () => {
    expect(
      foldsFromSegments(
        [
          { x: 0, y: 0, width: 0, height: 1104 },
          { x: NaN, y: 0, width: 442, height: 1104 },
          { x: 442, y: 0, width: 442, height: 1104 },
        ],
        884,
        1104,
      ),
    ).toEqual([]);
  });

  test("four segments - a fold each way - give both folds", () => {
    const folds: ReturnType<typeof foldsFromSegments> = foldsFromSegments(
      [
        { x: 0, y: 0, width: 400, height: 400 },
        { x: 400, y: 0, width: 400, height: 400 },
        { x: 0, y: 400, width: 400, height: 400 },
        { x: 400, y: 400, width: 400, height: 400 },
      ],
      800,
      800,
    );

    expect(
      folds.map((fold: ReturnType<typeof foldsFromSegments>[number]): string => {
        return fold.orientation;
      }),
    ).toEqual(["vertical", "horizontal", "horizontal", "vertical"]);
  });
});

describe("The browser as a posture source", () => {
  test("no window, or a browser without viewport segments, is no source", () => {
    expect(createViewportSegmentsSource(undefined)).toBeNull();
    expect(
      createViewportSegmentsSource(fakeWindow(884, 1104, undefined)),
    ).toBeNull();
    expect(createViewportSegmentsSource(fakeWindow(884, 1104, null))).toBeNull();
  });

  test("a browser whose viewport nothing splits reports a window without folds", () => {
    const source: PostureSource = createViewportSegmentsSource(
      fakeWindow(884, 1104, WHOLE_INNER_SCREEN),
    )!;

    expect(source.getCurrent()).toEqual({
      windowWidth: 884,
      windowHeight: 1104,
      folds: [],
    });
  });

  test("a split viewport reports its fold, for the window's own size", () => {
    const source: PostureSource = createViewportSegmentsSource(
      fakeWindow(1104, 884, TABLETOP_SEGMENTS),
    )!;

    expect(source.getCurrent()).toEqual({
      windowWidth: 1104,
      windowHeight: 884,
      folds: [
        {
          x: 0,
          y: 422,
          width: 1104,
          height: 40,
          orientation: "horizontal",
          separating: true,
        },
      ],
    });
  });

  test("a fold that starts or stops splitting the viewport is reported, through the segment queries", () => {
    const win: FakeWindow = fakeWindow(884, 1104, WHOLE_INNER_SCREEN);
    const source: PostureSource = createViewportSegmentsSource(win)!;
    const received: Array<FoldReport | null> = [];
    source.subscribe((report: FoldReport | null): void => {
      received.push(report);
    });

    win.setSegments(BOOK_SEGMENTS);
    win.fireQuery("(horizontal-viewport-segments: 2)");
    win.setSegments(WHOLE_INNER_SCREEN);
    win.fireQuery("(horizontal-viewport-segments: 2)");

    expect(
      received.map((report: FoldReport | null): number => {
        return report?.folds.length ?? -1;
      }),
    ).toEqual([1, 0]);
  });

  test("a resize - a rotation, a fold - is reported with the new window size", () => {
    const win: FakeWindow = fakeWindow(884, 1104, BOOK_SEGMENTS);
    const source: PostureSource = createViewportSegmentsSource(win)!;
    const listener: jest.Mock<(report: FoldReport | null) => void> = jest.fn();
    source.subscribe(listener);

    win.setSegments([{ x: 0, y: 0, width: 344, height: 882 }]);
    win.resize(344, 882);

    expect(listener).toHaveBeenCalledWith({
      windowWidth: 344,
      windowHeight: 882,
      folds: [],
    });
  });

  test("segments that go away mid-session report nothing, not a stale fold", () => {
    const win: FakeWindow = fakeWindow(884, 1104, BOOK_SEGMENTS);
    const source: PostureSource = createViewportSegmentsSource(win)!;
    const listener: jest.Mock<(report: FoldReport | null) => void> = jest.fn();
    source.subscribe(listener);

    win.setSegments(null);
    win.resize(884, 1104);

    expect(listener).toHaveBeenLastCalledWith(null);
  });

  test("it listens to the resize event and both segment queries, and unsubscribing removes them all", () => {
    const win: FakeWindow = fakeWindow(884, 1104, WHOLE_INNER_SCREEN);
    const source: PostureSource = createViewportSegmentsSource(win)!;

    const unsubscribe: () => void = source.subscribe(jest.fn());
    expect(win.listenerCounts()).toEqual({ resize: 1, queries: 2 });

    unsubscribe();
    expect(win.listenerCounts()).toEqual({ resize: 0, queries: 0 });
  });

  test("a browser without matchMedia still reports resizes", () => {
    const win: FakeWindow = fakeWindow(884, 1104, WHOLE_INNER_SCREEN, {
      withMatchMedia: false,
    });
    const source: PostureSource = createViewportSegmentsSource(win)!;
    const listener: jest.Mock<(report: FoldReport | null) => void> = jest.fn();

    const unsubscribe: () => void = source.subscribe(listener);
    win.resize(1104, 884);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(win.listenerCounts().resize).toBe(0);
  });
});
