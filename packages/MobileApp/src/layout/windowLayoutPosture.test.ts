import { describe, expect, test } from "@jest/globals";
import {
  MIN_LIST_PANE_WIDTH,
  MIN_PANE_WIDTH,
  MIN_STACKED_PANE_HEIGHT,
  NAVIGATION_RAIL_WIDTH,
  TABLETOP_FOLD_GAP,
  ZERO_INSETS,
  computeWindowLayout,
  type LayoutInsets,
  type WindowLayout,
} from "./windowLayout";
import {
  UNKNOWN_POSTURE,
  type WindowFold,
  type WindowPosture,
} from "./windowPosture";

/*
 * What the posture changes - and, first of all, what it does not.
 *
 * The posture is only ever known where the platform reports it (the Android
 * module, a browser with viewport segments). Everywhere else - iOS today,
 * Expo Go, an older build - the layout must be exactly the one #5260 shipped,
 * whatever else is passed in: the reader's dragged width included. That is
 * the "check that falls back to today's layout" the maintainer asked for, so
 * it is tested first, across the same real windows the layout rules are.
 */

interface RealWindow {
  name: string;
  width: number;
  height: number;
  insets?: Partial<LayoutInsets>;
}

const REAL_WINDOWS: Array<RealWindow> = [
  { name: "a 320pt small phone", width: 320, height: 568 },
  {
    name: "an iPhone held upright",
    width: 393,
    height: 852,
    insets: { top: 59, bottom: 34 },
  },
  { name: "a Galaxy Z Fold's cover screen", width: 344, height: 882 },
  { name: "a Galaxy Z Fold's inner screen", width: 884, height: 1104 },
  { name: "the inner screen on its side", width: 1104, height: 884 },
  { name: "a Pixel Fold held open", width: 841, height: 701 },
  { name: "a Galaxy Z Flip held open", width: 412, height: 914 },
  { name: "the iPhone Duo held open, wide", width: 951, height: 669 },
  { name: "the iPhone Duo held open, upright", width: 669, height: 951 },
  {
    name: "an iPhone on its side behind a notch",
    width: 852,
    height: 393,
    insets: { left: 59, right: 59, bottom: 21 },
  },
  {
    name: "a Pro Max iPhone on its side",
    width: 932,
    height: 430,
    insets: { left: 59, right: 59, bottom: 21 },
  },
  { name: "a 768pt tablet held upright", width: 768, height: 1024 },
  { name: "an iPad on its side", width: 1180, height: 820 },
  { name: "a 13-inch iPad on its side", width: 1376, height: 1032 },
  { name: "an Android desktop window", width: 1280, height: 800 },
];

function insetsOf(window: RealWindow): LayoutInsets {
  return { ...ZERO_INSETS, ...window.insets };
}

function book(x: number, height: number, width: number = 0): WindowPosture {
  const fold: WindowFold = {
    x,
    y: 0,
    width,
    height,
    orientation: "vertical",
    separating: true,
  };
  return { kind: "book", fold };
}

function tabletop(
  y: number,
  width: number,
  height: number = 0,
): WindowPosture {
  const fold: WindowFold = {
    x: 0,
    y,
    width,
    height,
    orientation: "horizontal",
    separating: true,
  };
  return { kind: "tabletop", fold };
}

const FLAT: WindowPosture = { kind: "flat", fold: null };

describe("Where nothing reports the posture, the layout is exactly today's", () => {
  test.each(REAL_WINDOWS)(
    "$name ($width x $height): unchanged, and a dragged width is ignored",
    (window: RealWindow) => {
      const today: WindowLayout = computeWindowLayout(
        { width: window.width, height: window.height },
        insetsOf(window),
      );
      const withUnknownPosture: WindowLayout = computeWindowLayout(
        { width: window.width, height: window.height },
        insetsOf(window),
        { posture: UNKNOWN_POSTURE, preferredListPaneWidth: 420 },
      );

      expect(withUnknownPosture).toEqual(today);
      expect(today.posture).toBe("unknown");
      expect(today.listPaneWidthRange).toBeNull();
      expect(today.paneArrangement).toBe("row");
      expect(today.paneGap).toBe(0);
      expect(today.splitAtFold).toBe(false);
      expect(today.listPaneWidth).toBe(today.defaultListPaneWidth);
    },
  );

  test("the panes keep the window's height, side by side", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 884,
      height: 1104,
    });

    expect(layout.detailPaneHeight).toBe(1104);
    expect(layout.listPaneHeight).toBe(1104);
  });

  test("one pane has no list height", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 393,
      height: 852,
    });

    expect(layout.detailPaneHeight).toBe(852);
    expect(layout.listPaneHeight).toBe(0);
  });
});

describe("Lying flat, the reader may drag the divider", () => {
  test("two panes offer the range both panes can live with", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: FLAT },
    );

    expect(layout.listPaneWidthRange).toEqual({
      min: MIN_LIST_PANE_WIDTH,
      max: 884 - NAVIGATION_RAIL_WIDTH - MIN_PANE_WIDTH,
    });
    // Until the reader moves it, it sits on the fold's line, as always.
    expect(layout.listPaneWidth).toBe(362);
    expect(layout.defaultListPaneWidth).toBe(362);
    expect(layout.splitAtCentre).toBe(true);
  });

  test("the reader's width is used, and the detail takes the rest", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: FLAT, preferredListPaneWidth: 400 },
    );

    expect(layout.listPaneWidth).toBe(400);
    expect(layout.detailPaneWidth).toBe(884 - NAVIGATION_RAIL_WIDTH - 400);
    expect(layout.defaultListPaneWidth).toBe(362);
    expect(layout.splitAtCentre).toBe(false);
  });

  test("a width the window cannot hold is fitted to it, never trusted", () => {
    const tooWide: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: FLAT, preferredListPaneWidth: 700 },
    );
    const tooNarrow: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: FLAT, preferredListPaneWidth: 120 },
    );

    expect(tooWide.listPaneWidth).toBe(884 - NAVIGATION_RAIL_WIDTH - 360);
    expect(tooWide.detailPaneWidth).toBe(MIN_PANE_WIDTH);
    expect(tooNarrow.listPaneWidth).toBe(MIN_LIST_PANE_WIDTH);
  });

  test("the same width serves a wider window as it is", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 1180, height: 820 },
      ZERO_INSETS,
      { posture: FLAT, preferredListPaneWidth: 520 },
    );

    expect(layout.listPaneWidth).toBe(520);
    expect(layout.listPaneWidthRange?.max).toBe(1180 - 80 - 360);
  });

  test.each([NaN, Infinity, -10, 0])(
    "a dragged width of %p is no width at all",
    (preferred: number) => {
      const layout: WindowLayout = computeWindowLayout(
        { width: 884, height: 1104 },
        ZERO_INSETS,
        { posture: FLAT, preferredListPaneWidth: preferred },
      );

      expect(layout.listPaneWidth).toBe(layout.defaultListPaneWidth);
    },
  );

  test("the detail keeps clear of a right-hand inset at the far end of the range", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 932, height: 430 },
      { top: 0, right: 59, bottom: 21, left: 59 },
      { posture: FLAT, preferredListPaneWidth: 2000 },
    );

    expect(layout.detailPaneWidth - 59).toBe(MIN_PANE_WIDTH);
  });

  test("one pane has no divider to drag", () => {
    for (const size of [
      { width: 344, height: 882 },
      { width: 768, height: 1024 },
      { width: 667, height: 375 },
    ]) {
      expect(
        computeWindowLayout(size, ZERO_INSETS, {
          posture: FLAT,
          preferredListPaneWidth: 400,
        }).listPaneWidthRange,
      ).toBeNull();
    }
  });
});

describe("Half open like a book, the panes meet on the fold", () => {
  test("a Galaxy Z Fold: on the fold down the middle, and the divider stays put", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: book(442, 1104), preferredListPaneWidth: 420 },
    );

    expect(layout.railWidth + layout.listPaneWidth).toBe(442);
    expect(layout.splitAtFold).toBe(true);
    expect(layout.splitAtCentre).toBe(true);
    expect(layout.listPaneWidthRange).toBeNull();
    expect(layout.posture).toBe("book");
  });

  test("a window that spans the fold off its centre still splits on the fold", () => {
    // Split screen across the fold: the fold sits at 520 of a 1280 window.
    const layout: WindowLayout = computeWindowLayout(
      { width: 1280, height: 800 },
      ZERO_INSETS,
      { posture: book(520, 800) },
    );

    expect(layout.railWidth + layout.listPaneWidth).toBe(520);
    expect(layout.splitAtFold).toBe(true);
    expect(layout.splitAtCentre).toBe(false);
    expect(layout.detailPaneWidth).toBe(1280 - 520);
  });

  test("a list wider than the centre rule allows is still put on the fold", () => {
    // 38% would leave the divider 95 points short of this fold.
    const layout: WindowLayout = computeWindowLayout(
      { width: 1200, height: 900 },
      ZERO_INSETS,
      { posture: book(600, 900) },
    );

    expect(layout.listPaneWidth).toBe(520);
    expect(layout.railWidth + layout.listPaneWidth).toBe(600);
  });

  test("a hinge between two screens is the space between the panes", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 1110, height: 900 },
      ZERO_INSETS,
      { posture: book(534, 900, 42) },
    );

    expect(layout.listPaneWidth).toBe(534 - NAVIGATION_RAIL_WIDTH);
    expect(layout.paneGap).toBe(42);
    expect(layout.detailPaneWidth).toBe(1110 - 534 - 42);
    expect(
      layout.railWidth +
        layout.listPaneWidth +
        layout.paneGap +
        layout.detailPaneWidth,
    ).toBe(1110);
  });

  test("a fold too near an edge for two whole panes leaves the layout as its size gives it", () => {
    const today: WindowLayout = computeWindowLayout({ width: 884, height: 1104 });
    const nearTheLeft: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: book(300, 1104) },
    );
    const nearTheRight: WindowLayout = computeWindowLayout(
      { width: 884, height: 1104 },
      ZERO_INSETS,
      { posture: book(600, 1104) },
    );

    for (const layout of [nearTheLeft, nearTheRight]) {
      expect(layout.listPaneWidth).toBe(today.listPaneWidth);
      expect(layout.splitAtFold).toBe(false);
      // Half open all the same: the divider is not offered for dragging.
      expect(layout.listPaneWidthRange).toBeNull();
    }
  });

  test("a narrow window half open as a book stays one pane", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 669, height: 951 },
      ZERO_INSETS,
      { posture: book(334.5, 951) },
    );

    expect(layout.panes).toBe(1);
    expect(layout.splitAtFold).toBe(false);
  });
});

describe("Half open on a table, the detail stands above the fold and the list lies below", () => {
  test("the inner screen on its side: stacked panes, the bar under the reader's hand", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 1104, height: 884 },
      ZERO_INSETS,
      { posture: tabletop(442, 1104), preferredListPaneWidth: 400 },
    );

    expect(layout.paneArrangement).toBe("stacked");
    expect(layout.panes).toBe(2);
    expect(layout.navigation).toBe("bar");
    expect(layout.railWidth).toBe(0);
    expect(layout.contentWidth).toBe(1104);
    expect(layout.listPaneWidth).toBe(1104);
    expect(layout.detailPaneWidth).toBe(1104);
    expect(layout.paneGap).toBe(TABLETOP_FOLD_GAP);
    expect(layout.detailPaneHeight).toBe(442 - TABLETOP_FOLD_GAP / 2);
    expect(layout.listPaneHeight).toBe(884 - 442 - TABLETOP_FOLD_GAP / 2);
    expect(layout.splitAtFold).toBe(true);
    expect(layout.listPaneWidthRange).toBeNull();
    expect(layout.posture).toBe("tabletop");
  });

  test("the band, the panes and the fold add up to the window, with the fold in the band's middle", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 412, height: 914 },
      ZERO_INSETS,
      { posture: tabletop(457, 412) },
    );

    expect(
      layout.detailPaneHeight + layout.paneGap + layout.listPaneHeight,
    ).toBe(914);
    expect(layout.detailPaneHeight + layout.paneGap / 2).toBe(457);
  });

  test("a Galaxy Z Flip half open: the list beside nothing, but below its detail", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 412, height: 914 },
      ZERO_INSETS,
      { posture: tabletop(457, 412) },
    );

    expect(layout.paneArrangement).toBe("stacked");
    expect(layout.panes).toBe(2);
    expect(layout.navigation).toBe("bar");
  });

  test("a hinge band wider than the gap keeps its own width", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 669, height: 951 },
      ZERO_INSETS,
      { posture: tabletop(455.5, 669, 40) },
    );

    expect(layout.paneGap).toBe(40);
    expect(layout.detailPaneHeight).toBe(455.5);
    expect(layout.listPaneHeight).toBe(951 - 495.5);
  });

  test("halves too short for a pane each leave the layout as the window's size gives it", () => {
    const today: WindowLayout = computeWindowLayout({ width: 852, height: 393 });
    const layout: WindowLayout = computeWindowLayout(
      { width: 852, height: 393 },
      ZERO_INSETS,
      { posture: tabletop(196.5, 852) },
    );

    expect(layout.paneArrangement).toBe("row");
    expect(layout.navigation).toBe(today.navigation);
    expect(layout.panes).toBe(today.panes);
    expect(layout.listPaneWidth).toBe(today.listPaneWidth);
  });

  test("a fold high in the window, leaving the lower half too short, does not stack", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 1104, height: 884 },
      ZERO_INSETS,
      { posture: tabletop(884 - MIN_STACKED_PANE_HEIGHT + 1, 1104) },
    );

    expect(layout.paneArrangement).toBe("row");
  });

  test("a window narrower than any list does not stack", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 300, height: 900 },
      ZERO_INSETS,
      { posture: tabletop(450, 300) },
    );

    expect(layout.paneArrangement).toBe("row");
    expect(layout.panes).toBe(1);
  });
});
