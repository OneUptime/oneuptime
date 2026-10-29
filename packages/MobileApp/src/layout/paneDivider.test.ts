import { describe, expect, test } from "@jest/globals";
import {
  DIVIDER_SNAP_DISTANCE,
  DIVIDER_STEP,
  clampListPaneWidth,
  describeListPaneShare,
  snapListPaneWidth,
  stepListPaneWidth,
  toPreferredListPaneWidth,
} from "./paneDivider";
import type { ListPaneWidthRange } from "./windowLayout";

/*
 * Where a dragged divider comes to rest on the unfolded Galaxy Z Fold held as
 * a book (884 points: the rail, then 804 shared): anywhere from a 320-point
 * list to a 360-point detail, and exactly on the fold's line (362) when let
 * go close to it.
 */
const RANGE: ListPaneWidthRange = { min: 320, max: 444 };
const ON_THE_FOLD: number = 362;

describe("clampListPaneWidth", () => {
  test("keeps a width inside the range as it is", () => {
    expect(clampListPaneWidth(400, RANGE)).toBe(400);
  });

  test("stops at either end of the range", () => {
    expect(clampListPaneWidth(100, RANGE)).toBe(320);
    expect(clampListPaneWidth(900, RANGE)).toBe(444);
  });

  test("a width that is not a number reads as the narrowest list", () => {
    expect(clampListPaneWidth(NaN, RANGE)).toBe(320);
    expect(clampListPaneWidth(Infinity, RANGE)).toBe(320);
  });
});

describe("snapListPaneWidth: where a drag ends", () => {
  test("let go near the fold's line, the divider settles exactly on it", () => {
    for (const offset of [
      -DIVIDER_SNAP_DISTANCE,
      -9,
      -1,
      0,
      4.6,
      DIVIDER_SNAP_DISTANCE,
    ]) {
      expect(snapListPaneWidth(ON_THE_FOLD + offset, RANGE, ON_THE_FOLD)).toBe(
        ON_THE_FOLD,
      );
    }
  });

  test("let go further away, it stays where it was let go, to a whole point", () => {
    expect(
      snapListPaneWidth(
        ON_THE_FOLD + DIVIDER_SNAP_DISTANCE + 1,
        RANGE,
        ON_THE_FOLD,
      ),
    ).toBe(ON_THE_FOLD + DIVIDER_SNAP_DISTANCE + 1);
    expect(snapListPaneWidth(410.4, RANGE, ON_THE_FOLD)).toBe(410);
    expect(snapListPaneWidth(330.6, RANGE, ON_THE_FOLD)).toBe(331);
  });

  test("dragged past either end, it rests at that end", () => {
    expect(snapListPaneWidth(10, RANGE, ON_THE_FOLD)).toBe(320);
    expect(snapListPaneWidth(2000, RANGE, ON_THE_FOLD)).toBe(444);
  });

  test("a layout position outside the range is never where it settles", () => {
    expect(snapListPaneWidth(325, RANGE, 310)).toBe(320);
  });
});

describe("stepListPaneWidth: a screen reader's increment and decrement", () => {
  test("each step moves the divider by one step", () => {
    expect(stepListPaneWidth(380, 1, { min: 320, max: 700 }, 362)).toBe(
      380 + DIVIDER_STEP,
    );
    expect(stepListPaneWidth(440, -1, { min: 320, max: 700 }, 362)).toBe(
      440 - DIVIDER_STEP,
    );
  });

  test("a step that would cross the fold's line stops on it", () => {
    expect(stepListPaneWidth(340, 1, RANGE, ON_THE_FOLD)).toBe(ON_THE_FOLD);
    expect(stepListPaneWidth(390, -1, RANGE, ON_THE_FOLD)).toBe(ON_THE_FOLD);
  });

  test("from the fold's line, a step moves on past it", () => {
    expect(stepListPaneWidth(ON_THE_FOLD, 1, RANGE, ON_THE_FOLD)).toBe(
      ON_THE_FOLD + DIVIDER_STEP,
    );
    expect(stepListPaneWidth(ON_THE_FOLD, -1, RANGE, ON_THE_FOLD)).toBe(
      ON_THE_FOLD - DIVIDER_STEP,
    );
  });

  test("a step stops at the end of the range", () => {
    expect(stepListPaneWidth(430, 1, RANGE, ON_THE_FOLD)).toBe(444);
    expect(stepListPaneWidth(330, -1, RANGE, ON_THE_FOLD)).toBe(320);
    expect(stepListPaneWidth(444, 1, RANGE, ON_THE_FOLD)).toBe(444);
  });
});

describe("toPreferredListPaneWidth: what is remembered", () => {
  test("nothing, for a divider where the layout puts it anyway", () => {
    expect(toPreferredListPaneWidth(ON_THE_FOLD, ON_THE_FOLD)).toBeNull();
    expect(toPreferredListPaneWidth(362.2, ON_THE_FOLD)).toBeNull();
  });

  test("the width, for a divider the reader moved", () => {
    expect(toPreferredListPaneWidth(410, ON_THE_FOLD)).toBe(410);
    expect(toPreferredListPaneWidth(320, ON_THE_FOLD)).toBe(320);
  });
});

describe("describeListPaneShare: what a screen reader says", () => {
  test("the list's share of the width the panes share, as a slider's value: 'List width, 45%'", () => {
    expect(describeListPaneShare(362, 804)).toBe("45%");
    expect(describeListPaneShare(402, 804)).toBe("50%");
    expect(describeListPaneShare(840, 1200)).toBe("70%");
  });

  test("nothing, without a width to share", () => {
    expect(describeListPaneShare(362, 0)).toBe("");
    expect(describeListPaneShare(362, NaN)).toBe("");
  });
});
