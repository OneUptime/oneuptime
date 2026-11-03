import { describe, expect, test } from "@jest/globals";
import {
  getSheetBackdropLayout,
  getSheetCorners,
  getSheetPlacement,
  type SheetPlacement,
} from "./sheetPlacement";
import {
  TABLETOP_FOLD_GAP,
  ZERO_INSETS,
  computeWindowLayout,
  type LayoutInsets,
  type WindowLayout,
} from "./windowLayout";
import { UNKNOWN_POSTURE, type WindowPosture } from "./windowPosture";
import { getScreenBottomPadding } from "../theme/layout";
import { spacing } from "../theme/tokens";

/*
 * Where a bottom sheet goes. Everywhere but a tabletop fold it is exactly
 * where it always was - each sheet keeps its own height limit and rises
 * above the keyboard itself. Half open on a table it rises over the half on
 * the table, stopping at the band, and hangs above the fold while the
 * keyboard takes that half.
 */

const INSETS: LayoutInsets = { top: 24, right: 0, bottom: 16, left: 0 };

function tabletop(y: number, width: number): WindowPosture {
  return {
    kind: "tabletop",
    fold: {
      x: 0,
      y,
      width,
      height: 0,
      orientation: "horizontal",
      separating: true,
    },
  };
}

function layoutFor(
  size: { width: number; height: number },
  posture: WindowPosture,
  insets: LayoutInsets = INSETS,
): WindowLayout {
  return computeWindowLayout(size, insets, { posture });
}

const INNER_ON_ITS_SIDE: { width: number; height: number } = {
  width: 1104,
  height: 884,
};

describe("everywhere but a tabletop fold, nothing changes", () => {
  test.each([
    ["a phone", { width: 390, height: 844 }, UNKNOWN_POSTURE],
    [
      "an unfolded foldable lying flat",
      { width: 884, height: 1104 },
      { kind: "flat", fold: null },
    ],
    ["a tablet on its side", { width: 1280, height: 800 }, UNKNOWN_POSTURE],
  ] as Array<[string, { width: number; height: number }, WindowPosture]>)(
    "%s: from the bottom edge, at the sheet's own height, above the keyboard",
    (
      _name: string,
      size: { width: number; height: number },
      posture: WindowPosture,
    ) => {
      for (const keyboardShown of [false, true]) {
        const placement: SheetPlacement = getSheetPlacement(
          layoutFor(size, posture),
          keyboardShown,
        );

        expect(placement).toEqual({
          anchor: "bottom",
          maxHeight: undefined,
          avoidsKeyboard: true,
          paddingTop: 0,
          // What useScreenPadding({ tabBar: false }) gave every sheet.
          paddingBottom: getScreenBottomPadding(INSETS.bottom, false),
        });
      }
    },
  );
});

describe("half open on a table", () => {
  const layout: WindowLayout = layoutFor(
    INNER_ON_ITS_SIDE,
    tabletop(442, 1104),
  );

  test("a sheet rises over the half on the table and stops at the band around the fold", () => {
    const placement: SheetPlacement = getSheetPlacement(layout, false);

    expect(placement.anchor).toBe("bottom");
    expect(placement.maxHeight).toBe(884 - (442 + TABLETOP_FOLD_GAP / 2));
    // Its top is never above the band, whatever it holds.
    expect(884 - placement.maxHeight!).toBe(442 + TABLETOP_FOLD_GAP / 2);
    // The placement keeps it clear of the fold; the keyboard does not push it.
    expect(placement.avoidsKeyboard).toBe(false);
    expect(placement.paddingTop).toBe(0);
    expect(placement.paddingBottom).toBe(
      getScreenBottomPadding(INSETS.bottom, false),
    );
  });

  test("with the keyboard up, it hangs above the fold - the screen up, the keys down - clear of the status bar", () => {
    const placement: SheetPlacement = getSheetPlacement(layout, true);

    expect(placement.anchor).toBe("top");
    expect(placement.paddingTop).toBe(INSETS.top);
    // From under the status bar to the band's top edge, and no further.
    expect(INSETS.top + placement.maxHeight!).toBe(442 - TABLETOP_FOLD_GAP / 2);
    expect(placement.avoidsKeyboard).toBe(false);
    // Its last button has room below it, not the window's bottom inset it no longer reaches.
    expect(placement.paddingBottom).toBe(spacing.xl);
  });

  test("the window's own insets, whichever pane opened the sheet", () => {
    /*
     * A pane above the fold hands its content no bottom inset (it does not
     * reach the window's bottom edge), but the sheet does: the window's
     * insets are what count.
     */
    const placement: SheetPlacement = getSheetPlacement(
      layoutFor(INNER_ON_ITS_SIDE, tabletop(442, 1104), {
        ...ZERO_INSETS,
        bottom: 34,
      }),
      false,
    );

    expect(placement.paddingBottom).toBe(getScreenBottomPadding(34, false));
  });

  test("odd insets never make a negative room", () => {
    const placement: SheetPlacement = getSheetPlacement(
      {
        paneArrangement: "stacked",
        detailPaneHeight: 10,
        listPaneHeight: -5,
        insets: { top: 40, right: 0, bottom: Number.NaN, left: 0 },
      },
      true,
    );

    expect(placement.maxHeight).toBe(0);
    expect(placement.paddingTop).toBe(40);

    const below: SheetPlacement = getSheetPlacement(
      {
        paneArrangement: "stacked",
        detailPaneHeight: 10,
        listPaneHeight: -5,
        insets: { top: 40, right: 0, bottom: Number.NaN, left: 0 },
      },
      false,
    );

    expect(below.maxHeight).toBe(0);
    expect(below.paddingBottom).toBe(getScreenBottomPadding(0, false));
  });
});

describe("the sheet's frame follows where it is", () => {
  const bottom: SheetPlacement = getSheetPlacement(
    layoutFor({ width: 390, height: 844 }, UNKNOWN_POSTURE),
    false,
  );
  const top: SheetPlacement = getSheetPlacement(
    layoutFor(INNER_ON_ITS_SIDE, tabletop(442, 1104)),
    true,
  );

  test("on the bottom edge: the backdrop holds it down, and only its top corners are round", () => {
    expect(getSheetBackdropLayout(bottom)).toEqual({
      justifyContent: "flex-end",
      paddingTop: 0,
    });
    expect(getSheetCorners(bottom, 22)).toEqual({
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    });
  });

  test("hung above the fold: the backdrop holds it up under the status bar, and all four corners are round", () => {
    expect(getSheetBackdropLayout(top)).toEqual({
      justifyContent: "flex-start",
      paddingTop: INSETS.top,
    });
    expect(getSheetCorners(top, 22)).toEqual({
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderBottomLeftRadius: 22,
      borderBottomRightRadius: 22,
    });
  });
});
