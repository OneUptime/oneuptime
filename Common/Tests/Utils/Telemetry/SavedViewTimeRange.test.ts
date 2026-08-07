import InBetween from "../../../Types/BaseDatabase/InBetween";
import { TelemetrySavedViewTimeRange } from "../../../Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  deserializeSavedViewTimeRange,
  readSavedViewTimeRange,
  serializeSavedViewTimeRange,
} from "../../../Utils/Telemetry/SavedViewTimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * A saved view stores a time *selection*, not the window that selection
 * resolved to at save time. Getting this wrong is invisible on the day the
 * view is saved — the frozen window and the rolling one still cover the same
 * minutes — and only shows up later, when "Past 1 Hour" comes back pointing at
 * an hour that has long since passed. These tests pin the distinction.
 */

const ROLLING_RANGES: Array<TimeRange> = (
  Object.values(TimeRange) as Array<TimeRange>
).filter((range: TimeRange): boolean => {
  return range !== TimeRange.CUSTOM;
});

describe("serializeSavedViewTimeRange", () => {
  test("stores a rolling range as its token alone", () => {
    const serialized: TelemetrySavedViewTimeRange = serializeSavedViewTimeRange(
      {
        range: TimeRange.PAST_ONE_HOUR,
      },
    );

    expect(serialized).toEqual({ range: TimeRange.PAST_ONE_HOUR });
    expect(serialized.startValue).toBeUndefined();
    expect(serialized.endValue).toBeUndefined();
  });

  test.each(ROLLING_RANGES)(
    "never stores absolute timestamps for %s",
    (range: TimeRange) => {
      const serialized: TelemetrySavedViewTimeRange =
        serializeSavedViewTimeRange({ range: range });

      expect(serialized).toEqual({ range: range });
    },
  );

  /*
   * The regression this whole module exists for: the picker keeps a resolved
   * window alongside a rolling token (the viewer needs it to query), and the
   * old code persisted that window. Carrying it here would freeze the range.
   */
  test("drops the resolved window that a rolling range carries", () => {
    const serialized: TelemetrySavedViewTimeRange = serializeSavedViewTimeRange(
      {
        range: TimeRange.PAST_ONE_HOUR,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-01-01T10:00:00.000Z"),
          new Date("2026-01-01T11:00:00.000Z"),
        ),
      },
    );

    expect(serialized).toEqual({ range: TimeRange.PAST_ONE_HOUR });
  });

  test("stores absolute ISO timestamps for a custom range", () => {
    const serialized: TelemetrySavedViewTimeRange = serializeSavedViewTimeRange(
      {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-01-01T10:00:00.000Z"),
          new Date("2026-01-02T10:00:00.000Z"),
        ),
      },
    );

    expect(serialized).toEqual({
      range: TimeRange.CUSTOM,
      startValue: "2026-01-01T10:00:00.000Z",
      endValue: "2026-01-02T10:00:00.000Z",
    });
  });

  /*
   * A picker state that has been through JSON once already hands back date
   * strings rather than Date instances, and `.toISOString()` on a string
   * throws.
   */
  test("normalizes date strings on a custom range", () => {
    const serialized: TelemetrySavedViewTimeRange = serializeSavedViewTimeRange(
      {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          "2026-01-01T10:00:00.000Z" as unknown as Date,
          "2026-01-02T10:00:00.000Z" as unknown as Date,
        ),
      },
    );

    expect(serialized).toEqual({
      range: TimeRange.CUSTOM,
      startValue: "2026-01-01T10:00:00.000Z",
      endValue: "2026-01-02T10:00:00.000Z",
    });
  });

  test("stores a custom range with no window as the token alone", () => {
    expect(serializeSavedViewTimeRange({ range: TimeRange.CUSTOM })).toEqual({
      range: TimeRange.CUSTOM,
    });
  });
});

describe("readSavedViewTimeRange", () => {
  test.each(ROLLING_RANGES)(
    "restores %s as a rolling range with no pinned window",
    (range: TimeRange) => {
      const restored: RangeStartAndEndDateTime | undefined =
        readSavedViewTimeRange({ range: range });

      expect(restored).toEqual({ range: range });
      expect(restored?.startAndEndDate).toBeUndefined();
    },
  );

  test("restores a custom range as its pinned window", () => {
    const restored: RangeStartAndEndDateTime | undefined =
      readSavedViewTimeRange({
        range: TimeRange.CUSTOM,
        startValue: "2026-01-01T10:00:00.000Z",
        endValue: "2026-01-02T10:00:00.000Z",
      });

    expect(restored?.range).toBe(TimeRange.CUSTOM);
    expect(restored?.startAndEndDate?.startValue).toEqual(
      new Date("2026-01-01T10:00:00.000Z"),
    );
    expect(restored?.startAndEndDate?.endValue).toEqual(
      new Date("2026-01-02T10:00:00.000Z"),
    );
  });

  test("accepts Date instances as well as strings on a custom range", () => {
    const restored: RangeStartAndEndDateTime | undefined =
      readSavedViewTimeRange({
        range: TimeRange.CUSTOM,
        startValue: new Date("2026-01-01T10:00:00.000Z"),
        endValue: new Date("2026-01-02T10:00:00.000Z"),
      });

    expect(restored?.startAndEndDate?.startValue).toEqual(
      new Date("2026-01-01T10:00:00.000Z"),
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "Past 1 Hour"],
    ["a number", 3600],
    ["an empty object", {}],
    ["a non-string range", { range: 42 }],
    ["an unknown range token", { range: "Past 7 Fortnights" }],
    ["a custom range with no window", { range: TimeRange.CUSTOM }],
    [
      "a custom range missing its end",
      { range: TimeRange.CUSTOM, startValue: "2026-01-01T10:00:00.000Z" },
    ],
    [
      "a custom range with unparseable dates",
      {
        range: TimeRange.CUSTOM,
        startValue: "not-a-date",
        endValue: "also-not-a-date",
      },
    ],
    [
      "a custom range with empty-string dates",
      { range: TimeRange.CUSTOM, startValue: "", endValue: "" },
    ],
  ])("returns undefined for %s", (_label: string, saved: unknown) => {
    expect(readSavedViewTimeRange(saved)).toBeUndefined();
  });
});

describe("deserializeSavedViewTimeRange", () => {
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["an unknown range token", { range: "Past 7 Fortnights" }],
    ["a custom range with unparseable dates", { range: TimeRange.CUSTOM }],
  ])("falls back to the past hour for %s", (_label: string, saved: unknown) => {
    expect(deserializeSavedViewTimeRange(saved)).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });

  test("passes through a usable stored range", () => {
    expect(
      deserializeSavedViewTimeRange({ range: TimeRange.PAST_TWO_DAYS }),
    ).toEqual({ range: TimeRange.PAST_TWO_DAYS });
  });
});

describe("round trip", () => {
  test.each(ROLLING_RANGES)(
    "%s survives serialize -> JSONB -> deserialize as a rolling range",
    (range: TimeRange) => {
      const stored: unknown = JSON.parse(
        JSON.stringify(serializeSavedViewTimeRange({ range: range })),
      );

      expect(deserializeSavedViewTimeRange(stored)).toEqual({ range: range });
    },
  );

  test("a custom range survives serialize -> JSONB -> deserialize intact", () => {
    const original: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2025-11-03T08:15:00.000Z"),
        new Date("2025-11-04T09:45:00.000Z"),
      ),
    };

    const stored: unknown = JSON.parse(
      JSON.stringify(serializeSavedViewTimeRange(original)),
    );

    const restored: RangeStartAndEndDateTime =
      deserializeSavedViewTimeRange(stored);

    expect(restored.range).toBe(TimeRange.CUSTOM);
    expect(restored.startAndEndDate?.startValue).toEqual(
      original.startAndEndDate?.startValue,
    );
    expect(restored.startAndEndDate?.endValue).toEqual(
      original.startAndEndDate?.endValue,
    );
  });
});
