import { describe, expect, test } from "@jest/globals";
import WorkspaceSummarySetup, {
  DEFAULT_LOOKBACK_DAYS,
  LOOKBACK_DAYS_COLUMN,
  MAX_LOOKBACK_DAYS,
  MIN_LOOKBACK_DAYS,
  WORKSPACE_SUMMARY_LOOKBACK_REASON,
  WORKSPACE_SUMMARY_NO_CHANNELS_REASON,
  WORKSPACE_SUMMARY_NO_ITEMS_REASON,
} from "../../../Utils/Workspace/WorkspaceSummarySetup";

/*
 * #7352: A WORKSPACE SUMMARY'S LOOKBACK PERIOD (DAYS) - how many days of
 * data each summary covers - is a whole number of days from 1 to a year.
 *
 * 0 was refused on create as "numberOfDaysOfData is required" and saved by
 * an edit; -5 was saved, and the summary then covered a window in the
 * future; 1.5 reached the integer column as a database error. Every write
 * is now held to 1 to 365 (readLookbackDays, in normalizeWrite), and a
 * stored value is read so that a summary never covers less than a day, a
 * window in the future or more than a year (getLookbackDays).
 */

describe("the Lookback Period's bounds", () => {
  test("a day to a year, and the 7 days a summary starts on", () => {
    expect(MIN_LOOKBACK_DAYS).toBe(1);
    expect(MAX_LOOKBACK_DAYS).toBe(365);
    expect(DEFAULT_LOOKBACK_DAYS).toBe(7);
  });

  test("names the column a summary keeps it in", () => {
    expect(LOOKBACK_DAYS_COLUMN).toBe("numberOfDaysOfData");
  });

  test("the refusal names the field as the form shows it, and what it takes", () => {
    expect(WORKSPACE_SUMMARY_LOOKBACK_REASON).toBe(
      "Lookback Period (Days) must be a whole number of days from 1 to 365 (a year).",
    );
    expect(WORKSPACE_SUMMARY_LOOKBACK_REASON).toContain(
      `from ${MIN_LOOKBACK_DAYS} to ${MAX_LOOKBACK_DAYS}`,
    );
  });
});

describe("what a write may save (readLookbackDays)", () => {
  test.each([
    [1, 1],
    [7, 7],
    [30, 30],
    [365, 365],
    ["7", 7],
    [" 14 ", 14],
    ["365", 365],
    // Text that is a whole number is the number it spells, written as one.
    ["7.0", 7],
    [7.0, 7],
  ])("%p saves as %p", (value: unknown, days: number) => {
    expect(WorkspaceSummarySetup.readLookbackDays(value)).toBe(days);
  });

  test.each([
    [0],
    [-0],
    [-1],
    [-5],
    [0.5],
    [1.5],
    [6.99],
    [366],
    [100000],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
    ["0"],
    ["-5"],
    ["1.5"],
    ["366"],
    ["seven"],
    ["7 days"],
    [""],
    ["   "],
    [null],
    [undefined],
    [true],
    [false],
    [{}],
    [[7]],
  ])("%p is not saved", (value: unknown) => {
    expect(WorkspaceSummarySetup.readLookbackDays(value)).toBeNull();
  });
});

describe("how many days a stored summary covers (getLookbackDays)", () => {
  test.each([
    [1, 1],
    [7, 7],
    [30, 30],
    [365, 365],
  ])(
    "a summary stored with %p covers %p days",
    (stored: number, days: number) => {
      expect(WorkspaceSummarySetup.getLookbackDays(stored)).toBe(days);
    },
  );

  test.each([[0], [-0], [-1], [-5], [null], [undefined], [Number.NaN], [1.5]])(
    "a summary stored with %p covers the 7 days the column defaults to, never a window in the future",
    (stored: unknown) => {
      expect(WorkspaceSummarySetup.getLookbackDays(stored)).toBe(7);
    },
  );

  test("one stored with more than a year covers a year", () => {
    expect(WorkspaceSummarySetup.getLookbackDays(366)).toBe(365);
    expect(WorkspaceSummarySetup.getLookbackDays(2 ** 31 - 1)).toBe(365);
  });

  test("a stored value read back as text is the number it spells", () => {
    expect(WorkspaceSummarySetup.getLookbackDays("14")).toBe(14);
    expect(WorkspaceSummarySetup.getLookbackDays("-5")).toBe(7);
  });

  test("whatever is stored, a summary covers a whole number of days from 1 to 365", () => {
    for (const stored of [
      -1000,
      -5,
      -1,
      0,
      1,
      7,
      365,
      366,
      1e9,
      Number.NaN,
      null,
      undefined,
      "x",
    ]) {
      const days: number = WorkspaceSummarySetup.getLookbackDays(stored);

      expect(Number.isInteger(days)).toBe(true);
      expect(days).toBeGreaterThanOrEqual(1);
      expect(days).toBeLessThanOrEqual(365);
    }
  });

  test("every value a write may save covers exactly those days", () => {
    for (const days of [1, 2, 7, 14, 30, 90, 364, 365]) {
      expect(
        WorkspaceSummarySetup.getLookbackDays(
          WorkspaceSummarySetup.readLookbackDays(days),
        ),
      ).toBe(days);
    }
  });
});

describe("normalizeWrite: the Lookback Period of a create or an update", () => {
  test.each([[0], [-5], [1.5], [366], ["0"], ["-5"], ["seven"], [""], [null]])(
    "%p is refused in the field's words",
    (value: unknown) => {
      expect(
        WorkspaceSummarySetup.normalizeWrite({ numberOfDaysOfData: value }),
      ).toBe(WORKSPACE_SUMMARY_LOOKBACK_REASON);
    },
  );

  test("text that spells a number of days is written back as the number", () => {
    const write: Record<string, unknown> = { numberOfDaysOfData: " 14 " };

    expect(WorkspaceSummarySetup.normalizeWrite(write)).toBeNull();
    expect(write).toEqual({ numberOfDaysOfData: 14 });
  });

  test("a write that does not touch it - a new name, the worker's next send - is never refused for it, and is left as it was", () => {
    const rename: Record<string, unknown> = {
      name: "Ops",
      numberOfDaysOfData: undefined,
    };

    expect(WorkspaceSummarySetup.normalizeWrite(rename)).toBeNull();
    expect(rename).toEqual({ name: "Ops", numberOfDaysOfData: undefined });

    const nextSend: Record<string, unknown> = {
      nextSendAt: new Date("2026-10-12T09:00:00.000Z"),
    };

    expect(WorkspaceSummarySetup.normalizeWrite(nextSend)).toBeNull();
    expect(Object.keys(nextSend)).toEqual(["nextSendAt"]);
  });

  test("with the channels or the items wrong as well, those are said first: what makes the summary unsendable", () => {
    expect(
      WorkspaceSummarySetup.normalizeWrite({
        channelNames: [],
        numberOfDaysOfData: -5,
      }),
    ).toBe(WORKSPACE_SUMMARY_NO_CHANNELS_REASON);
    expect(
      WorkspaceSummarySetup.normalizeWrite({
        summaryItems: [],
        numberOfDaysOfData: -5,
      }),
    ).toBe(WORKSPACE_SUMMARY_NO_ITEMS_REASON);
  });

  test("a whole write that is right: no refusal, and every column written back as it is saved", () => {
    const write: Record<string, unknown> = {
      channelNames: "#ops, #alerts",
      summaryItems: [" All "],
      numberOfDaysOfData: "30",
    };

    expect(WorkspaceSummarySetup.normalizeWrite(write)).toBeNull();
    expect(write).toEqual({
      channelNames: ["#ops", "#alerts"],
      summaryItems: ["All"],
      numberOfDaysOfData: 30,
    });
  });
});
