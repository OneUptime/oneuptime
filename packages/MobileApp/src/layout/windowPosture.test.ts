import { describe, expect, test } from "@jest/globals";
import {
  UNKNOWN_POSTURE,
  WINDOW_MATCH_TOLERANCE,
  getWindowPosture,
  parseFoldReport,
  reportMatchesWindow,
  type FoldReport,
  type WindowFold,
} from "./windowPosture";

/*
 * The posture is what the platform says about the window's folds, read
 * defensively: anything malformed, or meant for another window size, says
 * nothing, and "nothing" always means today's layout (UNKNOWN_POSTURE).
 */

const INNER_SCREEN: { width: number; height: number } = {
  width: 884,
  height: 1104,
};
const INNER_ON_ITS_SIDE: { width: number; height: number } = {
  width: 1104,
  height: 884,
};

function bookFold(overrides: Partial<WindowFold> = {}): WindowFold {
  return {
    x: 442,
    y: 0,
    width: 0,
    height: 1104,
    orientation: "vertical",
    separating: true,
    ...overrides,
  };
}

function tableFold(overrides: Partial<WindowFold> = {}): WindowFold {
  return {
    x: 0,
    y: 442,
    width: 1104,
    height: 0,
    orientation: "horizontal",
    separating: true,
    ...overrides,
  };
}

function reportFor(
  size: { width: number; height: number },
  folds: Array<WindowFold>,
): FoldReport {
  return { windowWidth: size.width, windowHeight: size.height, folds };
}

describe("parseFoldReport reads what the native module and the browser send", () => {
  test("a well-formed report comes through unchanged", () => {
    const raw: unknown = {
      windowWidth: 884,
      windowHeight: 1104,
      folds: [
        {
          x: 442,
          y: 0,
          width: 0,
          height: 1104,
          orientation: "vertical",
          separating: true,
        },
      ],
    };

    expect(parseFoldReport(raw)).toEqual(raw);
  });

  test("a report with no folds is a window that does not fold", () => {
    expect(
      parseFoldReport({ windowWidth: 768, windowHeight: 1024, folds: [] }),
    ).toEqual({ windowWidth: 768, windowHeight: 1024, folds: [] });
  });

  test("folds that are not a list read as none", () => {
    expect(
      parseFoldReport({ windowWidth: 768, windowHeight: 1024, folds: "none" }),
    ).toEqual({ windowWidth: 768, windowHeight: 1024, folds: [] });
    expect(parseFoldReport({ windowWidth: 768, windowHeight: 1024 })).toEqual({
      windowWidth: 768,
      windowHeight: 1024,
      folds: [],
    });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "folded"],
    ["a number", 42],
    ["no window size", { folds: [] }],
    ["a window width of zero", { windowWidth: 0, windowHeight: 1104 }],
    ["a negative window height", { windowWidth: 884, windowHeight: -1 }],
    [
      "a window size that is not a number",
      { windowWidth: "884", windowHeight: 1104 },
    ],
    ["an infinite window", { windowWidth: Infinity, windowHeight: 1104 }],
    ["a window size of NaN", { windowWidth: NaN, windowHeight: 1104 }],
  ])("%s is no report at all", (_name: string, raw: unknown) => {
    expect(parseFoldReport(raw)).toBeNull();
  });

  test.each([
    ["no bounds", { orientation: "vertical", separating: true }],
    ["a negative width", { ...bookFold(), width: -4 }],
    ["a negative height", { ...bookFold(), height: -1 }],
    ["a position that is not a number", { ...bookFold(), x: "442" }],
    ["an unknown direction", { ...bookFold(), orientation: "diagonal" }],
    ["a missing direction", { ...bookFold(), orientation: undefined }],
    ["an infinite position", { ...bookFold(), y: Infinity }],
    ["not an object", "fold"],
    ["null", null],
  ])(
    "a fold with %s is left out, and the rest kept",
    (_name: string, fold: unknown) => {
      const report: FoldReport | null = parseFoldReport({
        windowWidth: 884,
        windowHeight: 1104,
        folds: [fold, bookFold()],
      });

      expect(report?.folds).toEqual([bookFold()]);
    },
  );

  test("a fold splits the window only when the report says so in as many words", () => {
    const folds: ReadonlyArray<WindowFold> =
      parseFoldReport({
        windowWidth: 884,
        windowHeight: 1104,
        folds: [
          { ...bookFold(), separating: "true" },
          { ...bookFold(), separating: 1 },
          { ...bookFold(), separating: undefined },
          { ...bookFold(), separating: false },
          bookFold(),
        ],
      })?.folds ?? [];

    expect(
      folds.map((fold: WindowFold): boolean => {
        return fold.separating;
      }),
    ).toEqual([false, false, false, false, true]);
  });
});

describe("reportMatchesWindow ties a report to the window it was made for", () => {
  test("the same window matches, and so does one rounded a point or two apart", () => {
    const report: FoldReport = reportFor(INNER_SCREEN, []);

    expect(reportMatchesWindow(report, INNER_SCREEN)).toBe(true);
    expect(
      reportMatchesWindow(report, {
        width: INNER_SCREEN.width + WINDOW_MATCH_TOLERANCE,
        height: INNER_SCREEN.height - WINDOW_MATCH_TOLERANCE,
      }),
    ).toBe(true);
  });

  test("a rotation, a fold or a resize the report has not caught up with does not match", () => {
    const report: FoldReport = reportFor(INNER_SCREEN, []);

    expect(reportMatchesWindow(report, INNER_ON_ITS_SIDE)).toBe(false);
    expect(reportMatchesWindow(report, { width: 344, height: 882 })).toBe(
      false,
    );
    expect(
      reportMatchesWindow(report, {
        width: INNER_SCREEN.width + WINDOW_MATCH_TOLERANCE + 1,
        height: INNER_SCREEN.height,
      }),
    ).toBe(false);
  });
});

describe("getWindowPosture", () => {
  test("no report is no posture: the layout stays the one the window's size gives it", () => {
    expect(getWindowPosture(null, INNER_SCREEN)).toBe(UNKNOWN_POSTURE);
  });

  test("a report for another window size is no posture either", () => {
    const report: FoldReport = reportFor(INNER_SCREEN, [bookFold()]);

    expect(getWindowPosture(report, INNER_ON_ITS_SIDE)).toBe(UNKNOWN_POSTURE);
  });

  test("a window with no fold is flat: a tablet, a phone, the cover screen", () => {
    expect(getWindowPosture(reportFor(INNER_SCREEN, []), INNER_SCREEN)).toEqual(
      { kind: "flat", fold: null },
    );
  });

  test("a foldable lying flat open is flat: its fold splits nothing", () => {
    const report: FoldReport = reportFor(INNER_SCREEN, [
      bookFold({ separating: false }),
    ]);

    expect(getWindowPosture(report, INNER_SCREEN)).toEqual({
      kind: "flat",
      fold: null,
    });
  });

  test("half open with the fold running top to bottom is a book", () => {
    const fold: WindowFold = bookFold();

    expect(
      getWindowPosture(reportFor(INNER_SCREEN, [fold]), INNER_SCREEN),
    ).toEqual({ kind: "book", fold });
  });

  test("half open with the fold running side to side is a tabletop", () => {
    const fold: WindowFold = tableFold();

    expect(
      getWindowPosture(reportFor(INNER_ON_ITS_SIDE, [fold]), INNER_ON_ITS_SIDE),
    ).toEqual({ kind: "tabletop", fold });
  });

  test("a hinge between two screens splits the window even when the device lies flat", () => {
    // The platform reports it as separating whatever the angle.
    const fold: WindowFold = bookFold({ x: 408, width: 68 });

    expect(
      getWindowPosture(reportFor(INNER_SCREEN, [fold]), INNER_SCREEN).kind,
    ).toBe("book");
  });

  test("a fold along the window's edge, or outside it, splits nothing", () => {
    for (const fold of [
      bookFold({ x: 0 }),
      bookFold({ x: 884 }),
      bookFold({ x: 870, width: 14 }),
      bookFold({ x: 1200 }),
      tableFold({ y: 0 }),
      tableFold({ y: 1104 }),
    ]) {
      expect(
        getWindowPosture(reportFor(INNER_SCREEN, [fold]), INNER_SCREEN),
      ).toEqual({
        kind: "flat",
        fold: null,
      });
    }
  });

  test("the first fold that splits the window decides", () => {
    const flatFold: WindowFold = tableFold({ separating: false });
    const splitting: WindowFold = bookFold();

    expect(
      getWindowPosture(
        reportFor(INNER_SCREEN, [flatFold, splitting, tableFold({ y: 600 })]),
        INNER_SCREEN,
      ),
    ).toEqual({ kind: "book", fold: splitting });
  });
});
