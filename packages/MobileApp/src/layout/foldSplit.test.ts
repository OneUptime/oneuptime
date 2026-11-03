import { describe, expect, test } from "@jest/globals";
import {
  MIN_ABOVE_FOLD_HEIGHT,
  getFoldSplit,
  type FoldSplit,
  type FoldSplitLayout,
} from "./foldSplit";
import {
  TABLETOP_FOLD_GAP,
  ZERO_INSETS,
  computeWindowLayout,
  type WindowLayout,
} from "./windowLayout";
import {
  UNKNOWN_POSTURE,
  type WindowFold,
  type WindowPosture,
} from "./windowPosture";

/*
 * Where a tabletop fold splits a one-pane screen - Home, Settings - and,
 * first, where it does not.
 *
 * The split follows the stacked panes a list and its detail get (the same
 * fold, the same band), measured from the screen's own top: the bar above
 * the screen is part of the half above the fold. Every other posture keeps
 * the one scroll the screen always had.
 */

function tabletop(y: number, width: number, height: number = 0): WindowPosture {
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

function book(x: number, height: number): WindowPosture {
  return {
    kind: "book",
    fold: {
      x,
      y: 0,
      width: 0,
      height,
      orientation: "vertical",
      separating: true,
    },
  };
}

function layoutFor(
  size: { width: number; height: number },
  posture: WindowPosture,
): WindowLayout {
  return computeWindowLayout(size, ZERO_INSETS, { posture });
}

// A Galaxy Z Fold's inner screen on its side, and a Galaxy Z Flip, half open on a table.
const INNER_ON_ITS_SIDE: { width: number; height: number } = {
  width: 1104,
  height: 884,
};
const FLIP: { width: number; height: number } = { width: 412, height: 914 };

// The bar a Tab screen draws above itself: React Navigation's default, plus a status bar.
const BAR: number = 80;

describe("half open on a table, a one-pane screen splits on the fold", () => {
  test("the inner screen on its side: above runs from under the bar to the band, below from the band to the bottom", () => {
    const layout: WindowLayout = layoutFor(
      INNER_ON_ITS_SIDE,
      tabletop(442, 1104),
    );
    const split: FoldSplit | null = getFoldSplit(layout, BAR);

    expect(split).toEqual({
      aboveHeight: 442 - TABLETOP_FOLD_GAP / 2 - BAR,
      gap: TABLETOP_FOLD_GAP,
      belowHeight: 884 - (442 + TABLETOP_FOLD_GAP / 2),
    });
    // The bar, the half above, the band and the half below fill the window exactly.
    expect(BAR + split!.aboveHeight + split!.gap + split!.belowHeight).toBe(
      884,
    );
  });

  test("a Flip half open: the same, on a phone-width window", () => {
    const layout: WindowLayout = layoutFor(FLIP, tabletop(457, 412));
    const split: FoldSplit | null = getFoldSplit(layout, BAR);

    expect(split?.aboveHeight).toBe(457 - 12 - BAR);
    expect(split?.gap).toBe(TABLETOP_FOLD_GAP);
    expect(split?.belowHeight).toBe(914 - 457 - 12);
  });

  test("a hinge that hides part of the window keeps its own band, wider than the seamless one", () => {
    const layout: WindowLayout = layoutFor(
      INNER_ON_ITS_SIDE,
      tabletop(422, 1104, 40),
    );
    const split: FoldSplit | null = getFoldSplit(layout, BAR);

    expect(split?.gap).toBe(40);
    // The band is centred on the hinge: it starts where the hinge starts.
    expect(BAR + split!.aboveHeight).toBe(422);
    expect(split?.belowHeight).toBe(884 - 462);
  });

  test("a screen with no bar above it (a test, a screen drawn without a navigator) starts at the window's top", () => {
    const layout: WindowLayout = layoutFor(FLIP, tabletop(457, 412));

    expect(getFoldSplit(layout, 0)?.aboveHeight).toBe(445);
    expect(getFoldSplit(layout, -12)?.aboveHeight).toBe(445);
    expect(getFoldSplit(layout, Number.NaN)?.aboveHeight).toBe(445);
  });
});

describe("everywhere else the screen stays one scroll", () => {
  test("nothing reports a posture: no split, on every window", () => {
    for (const size of [INNER_ON_ITS_SIDE, FLIP, { width: 390, height: 844 }]) {
      expect(getFoldSplit(layoutFor(size, UNKNOWN_POSTURE), BAR)).toBeNull();
    }
  });

  test("lying flat and half open like a book: no split", () => {
    expect(
      getFoldSplit(
        layoutFor(INNER_ON_ITS_SIDE, { kind: "flat", fold: null }),
        BAR,
      ),
    ).toBeNull();
    expect(
      getFoldSplit(
        layoutFor({ width: 884, height: 1104 }, book(442, 1104)),
        BAR,
      ),
    ).toBeNull();
  });

  test("a tabletop fold too near an edge for two halves leaves the window as it is", () => {
    // 200 points above the fold: shorter than a pane may be (MIN_STACKED_PANE_HEIGHT).
    expect(
      getFoldSplit(layoutFor(INNER_ON_ITS_SIDE, tabletop(200, 1104)), BAR),
    ).toBeNull();
  });

  test("a bar too tall to leave a heading and a card above the fold keeps the one scroll", () => {
    const layout: WindowLayout = layoutFor(FLIP, tabletop(457, 412));
    const tallBar: number = 445 - MIN_ABOVE_FOLD_HEIGHT + 1;

    expect(getFoldSplit(layout, tallBar)).toBeNull();
    expect(getFoldSplit(layout, tallBar - 1)?.aboveHeight).toBe(
      MIN_ABOVE_FOLD_HEIGHT,
    );
  });

  test("a stacked layout with nothing below the fold is not split", () => {
    const layout: FoldSplitLayout = {
      paneArrangement: "stacked",
      detailPaneHeight: 400,
      listPaneHeight: 0,
      paneGap: 24,
    };

    expect(getFoldSplit(layout, BAR)).toBeNull();
  });

  test("panes in a row - the reader's own two panes - are not a tabletop split", () => {
    const layout: FoldSplitLayout = {
      paneArrangement: "row",
      detailPaneHeight: 884,
      listPaneHeight: 884,
      paneGap: 0,
    };

    expect(getFoldSplit(layout, BAR)).toBeNull();
  });
});
