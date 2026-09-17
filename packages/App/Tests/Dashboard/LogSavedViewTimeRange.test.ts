import {
  readLegacyTimeRangeFromQuery,
  resolveLogSavedViewTimeRange,
  withResolvedTime,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogSavedViewTimeRange";
import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { serializeSavedViewTimeRange } from "Common/Utils/Telemetry/SavedViewTimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * Saving a log view used to persist only the serialized query, and the query
 * can only express an absolute `time` window. So "Past 1 Hour" was stored as
 * the hour it happened to be at save time, and reopening the view a week later
 * showed that dead hour with the picker reading "Custom".
 *
 * The selection now rides in its own column and the query's window is rebuilt
 * from it on every apply. The stale window is still in `query` on rows saved
 * before the column existed, which is why resolution order matters here: the
 * stored selection must win over it, never the other way round.
 */

// Comfortably older than any rolling range these tests exercise.
const STALE_START: Date = new Date("2020-03-01T10:00:00.000Z");
const STALE_END: Date = new Date("2020-03-01T11:00:00.000Z");

function staleQuery(): Query<Log> {
  return {
    severityText: new Includes(["Error"]),
    time: new InBetween<Date>(STALE_START, STALE_END),
  } as unknown as Query<Log>;
}

describe("readLegacyTimeRangeFromQuery", () => {
  test("reads an absolute window out of a legacy query as a custom range", () => {
    const range: RangeStartAndEndDateTime | undefined =
      readLegacyTimeRangeFromQuery(staleQuery());

    expect(range?.range).toBe(TimeRange.CUSTOM);
    expect(range?.startAndEndDate?.startValue).toEqual(STALE_START);
    expect(range?.startAndEndDate?.endValue).toEqual(STALE_END);
  });

  test.each([
    ["an undefined query", undefined],
    ["a query with no time filter", { severityText: new Includes(["Error"]) }],
    ["a time filter that is not an InBetween", { time: "yesterday" }],
    [
      "an InBetween holding unparseable dates",
      { time: new InBetween("x", "y") },
    ],
  ])("returns undefined for %s", (_label: string, query: unknown) => {
    expect(
      readLegacyTimeRangeFromQuery(query as Query<Log> | undefined),
    ).toBeUndefined();
  });
});

describe("resolveLogSavedViewTimeRange", () => {
  /*
   * The reported bug, pinned. Every rolling range must come back rolling even
   * though the saved query still carries the window it resolved to.
   */
  test.each(
    (Object.values(TimeRange) as Array<TimeRange>).filter(
      (range: TimeRange): boolean => {
        return range !== TimeRange.CUSTOM;
      },
    ),
  )(
    "restores %s as a rolling range, not the window it was saved with",
    (range: TimeRange) => {
      const resolved: RangeStartAndEndDateTime = resolveLogSavedViewTimeRange({
        timeRange: serializeSavedViewTimeRange({ range: range }),
        query: staleQuery(),
      });

      expect(resolved).toEqual({ range: range });
      expect(resolved.range).not.toBe(TimeRange.CUSTOM);
      expect(resolved.startAndEndDate).toBeUndefined();
    },
  );

  test("restores a saved custom range as its pinned window", () => {
    const pinnedStart: Date = new Date("2026-02-01T00:00:00.000Z");
    const pinnedEnd: Date = new Date("2026-02-02T00:00:00.000Z");

    const resolved: RangeStartAndEndDateTime = resolveLogSavedViewTimeRange({
      timeRange: serializeSavedViewTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(pinnedStart, pinnedEnd),
      }),
      query: staleQuery(),
    });

    expect(resolved.range).toBe(TimeRange.CUSTOM);
    expect(resolved.startAndEndDate?.startValue).toEqual(pinnedStart);
    expect(resolved.startAndEndDate?.endValue).toEqual(pinnedEnd);
  });

  test("survives the JSONB round trip the column puts the selection through", () => {
    const stored: unknown = JSON.parse(
      JSON.stringify(
        serializeSavedViewTimeRange({ range: TimeRange.PAST_ONE_HOUR }),
      ),
    );

    expect(
      resolveLogSavedViewTimeRange({
        timeRange: stored as never,
        query: staleQuery(),
      }),
    ).toEqual({ range: TimeRange.PAST_ONE_HOUR });
  });

  /*
   * Back-compat. Rows saved before the column existed only know their absolute
   * window, and showing it as Custom is exactly what the user saw when they
   * saved it — better than guessing a rolling range they never picked.
   */
  test("falls back to the legacy query window when no selection was stored", () => {
    const resolved: RangeStartAndEndDateTime = resolveLogSavedViewTimeRange({
      query: staleQuery(),
    });

    expect(resolved.range).toBe(TimeRange.CUSTOM);
    expect(resolved.startAndEndDate?.startValue).toEqual(STALE_START);
    expect(resolved.startAndEndDate?.endValue).toEqual(STALE_END);
  });

  test.each([
    ["an empty object", {}],
    ["an unknown range token", { range: "Past 7 Fortnights" }],
    ["a custom range with no window", { range: TimeRange.CUSTOM }],
  ])(
    "falls back to the legacy query window when the stored selection is %s",
    (_label: string, timeRange: unknown) => {
      const resolved: RangeStartAndEndDateTime = resolveLogSavedViewTimeRange({
        timeRange: timeRange as never,
        query: staleQuery(),
      });

      expect(resolved.range).toBe(TimeRange.CUSTOM);
      expect(resolved.startAndEndDate?.startValue).toEqual(STALE_START);
    },
  );

  test("defaults to the past hour when the row carries neither", () => {
    expect(resolveLogSavedViewTimeRange({})).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });

  test("defaults to the past hour when both the selection and the query are junk", () => {
    expect(
      resolveLogSavedViewTimeRange({
        timeRange: { range: "nonsense" } as never,
        query: {
          severityText: new Includes(["Error"]),
        } as unknown as Query<Log>,
      }),
    ).toEqual({ range: TimeRange.PAST_ONE_HOUR });
  });
});

describe("withResolvedTime", () => {
  test("replaces the stale saved window with one that ends about now", () => {
    const before: number = Date.now();

    const query: Query<Log> = withResolvedTime(staleQuery(), {
      range: TimeRange.PAST_ONE_HOUR,
    });

    const after: number = Date.now();
    const time: InBetween<Date> = (query as Record<string, unknown>)[
      "time"
    ] as InBetween<Date>;

    expect(time).toBeInstanceOf(InBetween);
    expect(time.endValue.getTime()).toBeGreaterThanOrEqual(before);
    expect(time.endValue.getTime()).toBeLessThanOrEqual(after);
    expect(time.endValue.getTime() - time.startValue.getTime()).toBe(
      60 * 60 * 1000,
    );

    // The window the view was saved with is gone.
    expect(time.startValue).not.toEqual(STALE_START);
    expect(time.endValue).not.toEqual(STALE_END);
  });

  test.each([
    [TimeRange.PAST_FIVE_MINS, 5 * 60 * 1000],
    [TimeRange.PAST_FIFTEEN_MINS, 15 * 60 * 1000],
    [TimeRange.PAST_THIRTY_MINS, 30 * 60 * 1000],
    [TimeRange.PAST_ONE_HOUR, 60 * 60 * 1000],
    [TimeRange.PAST_TWO_HOURS, 2 * 60 * 60 * 1000],
    [TimeRange.PAST_THREE_HOURS, 3 * 60 * 60 * 1000],
    [TimeRange.PAST_ONE_DAY, 24 * 60 * 60 * 1000],
    [TimeRange.PAST_TWO_DAYS, 2 * 24 * 60 * 60 * 1000],
    [TimeRange.PAST_ONE_WEEK, 7 * 24 * 60 * 60 * 1000],
    [TimeRange.PAST_TWO_WEEKS, 14 * 24 * 60 * 60 * 1000],
  ])("spans the right window for %s", (range: TimeRange, spanInMs: number) => {
    const query: Query<Log> = withResolvedTime(staleQuery(), { range: range });
    const time: InBetween<Date> = (query as Record<string, unknown>)[
      "time"
    ] as InBetween<Date>;

    expect(time.endValue.getTime() - time.startValue.getTime()).toBe(spanInMs);
  });

  test("keeps a custom range pinned to its own window", () => {
    const pinnedStart: Date = new Date("2026-02-01T00:00:00.000Z");
    const pinnedEnd: Date = new Date("2026-02-02T00:00:00.000Z");

    const query: Query<Log> = withResolvedTime(staleQuery(), {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(pinnedStart, pinnedEnd),
    });

    const time: InBetween<Date> = (query as Record<string, unknown>)[
      "time"
    ] as InBetween<Date>;

    expect(time.startValue).toEqual(pinnedStart);
    expect(time.endValue).toEqual(pinnedEnd);
  });

  test("leaves the rest of the query untouched", () => {
    const query: Query<Log> = withResolvedTime(staleQuery(), {
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect((query as Record<string, unknown>)["severityText"]).toEqual(
      new Includes(["Error"]),
    );
  });

  test("does not mutate the query it is given", () => {
    const original: Query<Log> = staleQuery();

    withResolvedTime(original, { range: TimeRange.PAST_ONE_HOUR });

    expect(
      ((original as Record<string, unknown>)["time"] as InBetween<Date>)
        .startValue,
    ).toEqual(STALE_START);
  });

  test("adds a window to a query that had none", () => {
    const query: Query<Log> = withResolvedTime(
      { severityText: new Includes(["Error"]) } as unknown as Query<Log>,
      { range: TimeRange.PAST_ONE_HOUR },
    );

    expect((query as Record<string, unknown>)["time"]).toBeInstanceOf(
      InBetween,
    );
  });
});

describe("apply after save", () => {
  /*
   * End to end over the pure pieces: capture a rolling selection, store it the
   * way the column does, then apply it. What comes back must be the rolling
   * selection and a window anchored to the current clock — the behaviour the
   * bug report says was missing.
   */
  test("a rolling view saved long ago queries the current window", () => {
    const savedRow: { timeRange: unknown; query: Query<Log> } = JSON.parse(
      JSON.stringify({
        timeRange: serializeSavedViewTimeRange({
          range: TimeRange.PAST_ONE_HOUR,
        }),
        query: { time: new InBetween<Date>(STALE_START, STALE_END) },
      }),
    );

    const resolved: RangeStartAndEndDateTime = resolveLogSavedViewTimeRange({
      timeRange: savedRow.timeRange as never,
      query: staleQuery(),
    });

    expect(resolved).toEqual({ range: TimeRange.PAST_ONE_HOUR });

    const time: InBetween<Date> = (
      withResolvedTime(staleQuery(), resolved) as Record<string, unknown>
    )["time"] as InBetween<Date>;

    expect(time.endValue.getTime()).toBeGreaterThan(STALE_END.getTime());
    expect(Date.now() - time.endValue.getTime()).toBeLessThan(5000);
  });
});
