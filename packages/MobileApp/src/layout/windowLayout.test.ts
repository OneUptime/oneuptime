import { describe, expect, test } from "@jest/globals";
import {
  EXPANDED_WIDTH,
  MAX_LIST_PANE_WIDTH,
  MEDIUM_WIDTH,
  MIN_LIST_PANE_WIDTH,
  MIN_PANE_WIDTH,
  NAVIGATION_RAIL_WIDTH,
  READABLE_CONTENT_WIDTH,
  SCREEN_GUTTER,
  ZERO_INSETS,
  computeWindowLayout,
  getContentGutters,
  getHeightClass,
  getReadableGutter,
  getWidthClass,
  type LayoutInsets,
  type WindowLayout,
} from "./windowLayout";

/*
 * The layout rules are the whole promise of this change: one pane or two,
 * a bar or a rail, where the divider sits. They are decided from the window
 * alone, so they are tested here as a table of real windows - the cover and
 * inner screens of the foldables people carry, phones on their side, tablets,
 * split screen - rather than as a table of devices, which the code never
 * looks at.
 */

interface WindowCase {
  name: string;
  width: number;
  height: number;
  insets?: Partial<LayoutInsets>;
  navigation: "bar" | "rail";
  panes: 1 | 2;
  splitAtCentre?: boolean;
}

function layoutOf(windowCase: WindowCase): WindowLayout {
  return computeWindowLayout(
    { width: windowCase.width, height: windowCase.height },
    { ...ZERO_INSETS, ...windowCase.insets },
  );
}

const WINDOWS: Array<WindowCase> = [
  // Phones held upright: the app as it has always been.
  { name: "a 320pt small phone", width: 320, height: 568, navigation: "bar", panes: 1 },
  { name: "an iPhone held upright", width: 393, height: 852, insets: { top: 59, bottom: 34 }, navigation: "bar", panes: 1 },
  { name: "an Android phone held upright", width: 412, height: 915, navigation: "bar", panes: 1 },

  // Foldables, folded and unfolded.
  { name: "a Galaxy Z Fold's cover screen", width: 344, height: 882, navigation: "bar", panes: 1 },
  { name: "a Galaxy Z Fold's inner screen held as a book", width: 884, height: 1104, navigation: "rail", panes: 2, splitAtCentre: true },
  { name: "a Galaxy Z Fold's inner screen on its side", width: 1104, height: 884, navigation: "rail", panes: 2, splitAtCentre: false },
  { name: "a Pixel Fold held open", width: 841, height: 701, navigation: "rail", panes: 2, splitAtCentre: true },
  { name: "the iPhone Duo's cover screen upright", width: 466, height: 678, insets: { top: 44, bottom: 21 }, navigation: "bar", panes: 1 },
  { name: "the iPhone Duo's cover screen on its side", width: 678, height: 466, navigation: "rail", panes: 1 },
  { name: "the iPhone Duo held open, upright", width: 669, height: 951, navigation: "bar", panes: 1 },
  { name: "the iPhone Duo held open, wide", width: 951, height: 669, navigation: "rail", panes: 2, splitAtCentre: true },

  // Phones on their side.
  { name: "an iPhone on its side behind a notch", width: 852, height: 393, insets: { left: 59, right: 59, bottom: 21 }, navigation: "rail", panes: 1 },
  { name: "a Pro Max iPhone on its side", width: 932, height: 430, insets: { left: 59, right: 59, bottom: 21 }, navigation: "rail", panes: 2, splitAtCentre: true },
  { name: "an Android phone on its side", width: 915, height: 412, navigation: "rail", panes: 2, splitAtCentre: true },
  { name: "an iPhone SE on its side", width: 667, height: 375, navigation: "rail", panes: 1 },

  // Tablets.
  { name: "an iPad mini held upright", width: 744, height: 1133, navigation: "bar", panes: 1 },
  { name: "an iPad held upright", width: 820, height: 1180, navigation: "bar", panes: 1 },
  { name: "a 768pt tablet held upright", width: 768, height: 1024, navigation: "bar", panes: 1 },
  { name: "an iPad on its side", width: 1180, height: 820, navigation: "rail", panes: 2, splitAtCentre: false },
  { name: "a 13-inch iPad on its side", width: 1376, height: 1032, navigation: "rail", panes: 2, splitAtCentre: false },

  // Windows that belong to no device in particular.
  { name: "half an iPad in Split View", width: 590, height: 820, navigation: "bar", panes: 1 },
  { name: "a phone's half of a split screen", width: 412, height: 450, navigation: "bar", panes: 1 },
  { name: "an Android desktop window", width: 1280, height: 800, navigation: "rail", panes: 2, splitAtCentre: false },
  { name: "the size React Native's test environment reports", width: 750, height: 1334, navigation: "bar", panes: 1 },
];

describe("Which layout each window gets", () => {
  test.each(WINDOWS)(
    "$name ($width x $height): $navigation, $panes pane(s)",
    (windowCase: WindowCase) => {
      const layout: WindowLayout = layoutOf(windowCase);

      expect(layout.navigation).toBe(windowCase.navigation);
      expect(layout.panes).toBe(windowCase.panes);
      if (windowCase.splitAtCentre !== undefined) {
        expect(layout.splitAtCentre).toBe(windowCase.splitAtCentre);
      }
    },
  );

  test.each(WINDOWS.filter((windowCase: WindowCase) => {
    return windowCase.panes === 2;
  }))(
    "$name gives both panes at least a phone's width",
    (windowCase: WindowCase) => {
      const layout: WindowLayout = layoutOf(windowCase);
      const insetRight: number = windowCase.insets?.right ?? 0;

      expect(layout.listPaneWidth).toBeGreaterThanOrEqual(MIN_LIST_PANE_WIDTH);
      expect(layout.listPaneWidth).toBeLessThanOrEqual(MAX_LIST_PANE_WIDTH);
      expect(layout.detailPaneWidth - insetRight).toBeGreaterThanOrEqual(
        MIN_PANE_WIDTH,
      );
      expect(
        layout.railWidth + layout.listPaneWidth + layout.detailPaneWidth,
      ).toBeCloseTo(windowCase.width, 6);
    },
  );

  test.each(WINDOWS.filter((windowCase: WindowCase) => {
    return windowCase.panes === 1;
  }))("$name has no list pane at all", (windowCase: WindowCase) => {
    const layout: WindowLayout = layoutOf(windowCase);

    expect(layout.listPaneWidth).toBe(0);
    expect(layout.detailPaneWidth).toBe(layout.contentWidth);
    expect(layout.splitAtCentre).toBe(false);
  });
});

describe("Keeping the divider on the fold", () => {
  test("an unfolded Galaxy Z Fold splits exactly down the middle, where its fold runs", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 884,
      height: 1104,
    });

    expect(layout.railWidth).toBe(NAVIGATION_RAIL_WIDTH);
    expect(layout.railWidth + layout.listPaneWidth).toBe(442);
    expect(layout.listPaneWidth).toBe(362);
    expect(layout.detailPaneWidth).toBe(442);
  });

  test("the iPhone Duo held open splits on its centre line, half points and all", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 951,
      height: 669,
    });

    expect(layout.railWidth + layout.listPaneWidth).toBeCloseTo(475.5, 6);
    expect(layout.detailPaneWidth).toBeCloseTo(475.5, 6);
  });

  test("a notch on the left is covered by the rail, and the split still lands on the centre", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: 932, height: 430 },
      { top: 0, right: 59, bottom: 21, left: 59 },
    );

    expect(layout.railWidth).toBe(NAVIGATION_RAIL_WIDTH + 59);
    expect(layout.railWidth + layout.listPaneWidth).toBe(466);
  });

  test("a window too wide for a centre split gives the list 38% of the space", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 1180,
      height: 820,
    });

    expect(layout.splitAtCentre).toBe(false);
    expect(layout.listPaneWidth).toBe(Math.round((1180 - 80) * 0.38));
    expect(layout.detailPaneWidth).toBe(1180 - 80 - layout.listPaneWidth);
  });

  test("and never more than 420 points, however wide the window", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 2560,
      height: 1440,
    });

    expect(layout.listPaneWidth).toBe(420);
    expect(layout.detailPaneWidth).toBe(2560 - 80 - 420);
  });

  test("a list that would be too narrow at the centre is given a phone's width instead", () => {
    /*
     * 840 points with a 100-point inset on the left: the centre line would
     * leave the list 240 points, so it gets the 360 it needs and the
     * divider moves off-centre.
     */
    const layout: WindowLayout = computeWindowLayout(
      { width: 900, height: 600 },
      { top: 0, right: 0, bottom: 0, left: 100 },
    );

    expect(layout.panes).toBe(2);
    expect(layout.splitAtCentre).toBe(false);
    expect(layout.listPaneWidth).toBe(MIN_PANE_WIDTH);
  });
});

describe("The breakpoints themselves", () => {
  test("two panes need Material's expanded width, not just two phone widths", () => {
    // 839 points has room for two 360-point panes beside a rail, but it is
    // a medium window - a tablet held upright - and gets one pane.
    expect(
      computeWindowLayout({ width: EXPANDED_WIDTH - 1, height: 600 }).panes,
    ).toBe(1);
    expect(
      computeWindowLayout({ width: EXPANDED_WIDTH, height: 600 }).panes,
    ).toBe(2);
  });

  test("and two phone widths beside the rail and the right inset", () => {
    expect(
      computeWindowLayout(
        { width: 860, height: 400 },
        { top: 0, right: 30, bottom: 0, left: 31 },
      ).panes,
    ).toBe(1);
    expect(
      computeWindowLayout(
        { width: 860, height: 400 },
        { top: 0, right: 30, bottom: 0, left: 30 },
      ).panes,
    ).toBe(2);
  });

  test("the rail starts at Material's medium width, for windows wider than tall", () => {
    expect(
      computeWindowLayout({ width: MEDIUM_WIDTH - 1, height: 400 }).navigation,
    ).toBe("bar");
    expect(
      computeWindowLayout({ width: MEDIUM_WIDTH, height: 400 }).navigation,
    ).toBe("rail");
  });

  test("a square window keeps the bar until it has two panes", () => {
    expect(computeWindowLayout({ width: 700, height: 700 }).navigation).toBe(
      "bar",
    );
  });

  test.each([
    [0, "compact"],
    [599, "compact"],
    [600, "medium"],
    [839, "medium"],
    [840, "expanded"],
    [1600, "expanded"],
  ] as Array<[number, string]>)(
    "a %dpt wide window is %s",
    (width: number, expected: string) => {
      expect(getWidthClass(width)).toBe(expected);
    },
  );

  test.each([
    [0, "compact"],
    [479, "compact"],
    [480, "medium"],
    [899, "medium"],
    [900, "expanded"],
  ] as Array<[number, string]>)(
    "a %dpt tall window is %s",
    (height: number, expected: string) => {
      expect(getHeightClass(height)).toBe(expected);
    },
  );

  test("the layout carries its classes and the content width beside the rail", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 1104,
      height: 884,
    });

    expect(layout.widthClass).toBe("expanded");
    expect(layout.heightClass).toBe("medium");
    expect(layout.contentWidth).toBe(1104 - NAVIGATION_RAIL_WIDTH);
  });

  test("nonsense sizes and insets read as nothing rather than as negative space", () => {
    const layout: WindowLayout = computeWindowLayout(
      { width: Number.NaN, height: -10 },
      { top: -1, right: Number.POSITIVE_INFINITY, bottom: 0, left: -20 },
    );

    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
    expect(layout.insets).toEqual(ZERO_INSETS);
    expect(layout.navigation).toBe("bar");
    expect(layout.panes).toBe(1);
    expect(layout.contentWidth).toBe(0);
  });
});

describe("Keeping text and controls at a readable width", () => {
  test("a phone keeps its 20-point gutter", () => {
    expect(getReadableGutter(390)).toBe(SCREEN_GUTTER);
    expect(getReadableGutter(READABLE_CONTENT_WIDTH + 40)).toBe(SCREEN_GUTTER);
  });

  test("a wide pane centres a 720-point column of content", () => {
    expect(getReadableGutter(1100)).toBe((1100 - READABLE_CONTENT_WIDTH) / 2);
  });

  test("React Native's 750-point test window keeps the phone gutter, so nothing about it moved", () => {
    expect(getReadableGutter(750)).toBe(SCREEN_GUTTER);
  });

  test("gutters add each edge's own safe-area inset, so an off-centre camera is never covered", () => {
    expect(
      getContentGutters({ width: 852, insetLeft: 0, insetRight: 59 }),
    ).toEqual({
      paddingLeft: Math.max(20, (852 - 59 - 720) / 2),
      paddingRight: 59 + Math.max(20, (852 - 59 - 720) / 2),
    });
  });

  test("a phone-width pane with no insets is padded exactly as before", () => {
    expect(
      getContentGutters({ width: 390, insetLeft: 0, insetRight: 0 }),
    ).toEqual({ paddingLeft: 20, paddingRight: 20 });
  });

  test("a 13-inch iPad's detail pane keeps its content to 720 points", () => {
    const layout: WindowLayout = computeWindowLayout({
      width: 1376,
      height: 1032,
    });
    const gutters: { paddingLeft: number; paddingRight: number } =
      getContentGutters({
        width: layout.detailPaneWidth,
        insetLeft: 0,
        insetRight: 0,
      });

    expect(
      layout.detailPaneWidth - gutters.paddingLeft - gutters.paddingRight,
    ).toBe(READABLE_CONTENT_WIDTH);
  });
});
