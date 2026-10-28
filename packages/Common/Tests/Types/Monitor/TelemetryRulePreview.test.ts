import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import TelemetryRulePreviewUtil, {
  MAX_PREVIEW_RANGE_IN_SECONDS,
  MAX_PREVIEW_WINDOW_IN_SECONDS,
  MIN_PREVIEW_WINDOW_IN_SECONDS,
  PREVIEW_WINDOW_COUNT,
  TelemetryRulePreviewAnswer,
  TelemetryRulePreviewPoint,
  TelemetryRulePreviewRange,
  TelemetryRulePreviewSummary,
} from "../../../Types/Monitor/TelemetryRulePreview";
import { describe, expect, test } from "@jest/globals";

/*
 * The windows a telemetry rule's preview reads, and what the rule makes of
 * them. The preview is the count a Logs, Traces or Exceptions monitor
 * compares, for every window of the same length back from now: these
 * tests pin that the read is bounded (a fixed number of windows, never
 * more than a week), that the windows are whole, that empty windows count
 * as 0, and how "would have fired" and the suggested threshold are worked
 * out.
 */

const NOW: Date = new Date("2026-10-27T12:07:31.250Z");

type RangeFunction = (windowInSeconds: number) => TelemetryRulePreviewRange;

const range: RangeFunction = (
  windowInSeconds: number,
): TelemetryRulePreviewRange => {
  return TelemetryRulePreviewUtil.getRange({ windowInSeconds, now: NOW });
};

type PointsFunction = (values: Array<number>) => Array<TelemetryRulePreviewPoint>;

const points: PointsFunction = (
  values: Array<number>,
): Array<TelemetryRulePreviewPoint> => {
  return values.map((value: number, index: number) => {
    return { time: new Date(NOW.getTime() + index * 60000), value };
  });
};

describe("The windows a preview reads", () => {
  test("a five-minute rule reads 144 whole windows: the last 12 hours, ending on the last whole window", () => {
    const fiveMinutes: TelemetryRulePreviewRange = range(300);

    expect(fiveMinutes.windowInSeconds).toBe(300);
    expect(fiveMinutes.endTime.toISOString()).toBe("2026-10-27T12:05:00.000Z");
    expect(fiveMinutes.startTime.toISOString()).toBe(
      "2026-10-27T00:05:00.000Z",
    );
    expect(
      (fiveMinutes.endTime.getTime() - fiveMinutes.startTime.getTime()) /
        300000,
    ).toBe(PREVIEW_WINDOW_COUNT);
  });

  test("a one-minute rule reads 2.4 hours, a 15-minute one 36 hours", () => {
    const oneMinute: TelemetryRulePreviewRange = range(60);
    expect(oneMinute.endTime.toISOString()).toBe("2026-10-27T12:07:00.000Z");
    expect(
      (oneMinute.endTime.getTime() - oneMinute.startTime.getTime()) / 3600000,
    ).toBeCloseTo(2.4);

    const fifteenMinutes: TelemetryRulePreviewRange = range(900);
    expect(
      (fifteenMinutes.endTime.getTime() - fifteenMinutes.startTime.getTime()) /
        3600000,
    ).toBe(36);
  });

  test("long windows are capped at a week: fewer, longer windows", () => {
    for (const windowInSeconds of [3600, 21600, 43200, 86400]) {
      const read: TelemetryRulePreviewRange = range(windowInSeconds);
      const spanInSeconds: number =
        (read.endTime.getTime() - read.startTime.getTime()) / 1000;

      expect(spanInSeconds).toBeLessThanOrEqual(MAX_PREVIEW_RANGE_IN_SECONDS);
      expect(spanInSeconds % windowInSeconds).toBe(0);
      expect(spanInSeconds / windowInSeconds).toBeLessThanOrEqual(
        PREVIEW_WINDOW_COUNT,
      );
      expect(read.endTime.getTime() % (windowInSeconds * 1000)).toBe(0);
    }

    expect(
      (range(86400).endTime.getTime() - range(86400).startTime.getTime()) /
        86400000,
    ).toBe(7);
  });

  test("no window, and no range, is ever larger than the bounds", () => {
    for (const windowInSeconds of [
      1, 5, 10, 30, 60, 300, 900, 1800, 3600, 21600, 43200, 86400, 604800,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const read: TelemetryRulePreviewRange = range(windowInSeconds);

      expect(read.windowInSeconds).toBeGreaterThanOrEqual(
        MIN_PREVIEW_WINDOW_IN_SECONDS,
      );
      expect(read.windowInSeconds).toBeLessThanOrEqual(
        MAX_PREVIEW_WINDOW_IN_SECONDS,
      );
      expect(read.endTime.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(
        (read.endTime.getTime() - read.startTime.getTime()) / 1000,
      ).toBeLessThanOrEqual(MAX_PREVIEW_RANGE_IN_SECONDS);
      expect(
        (read.endTime.getTime() - read.startTime.getTime()) /
          1000 /
          read.windowInSeconds,
      ).toBeLessThanOrEqual(PREVIEW_WINDOW_COUNT);
    }
  });

  test("a window that is not a number of seconds reads as a minute", () => {
    expect(TelemetryRulePreviewUtil.clampWindow(Number.NaN)).toBe(60);
    expect(TelemetryRulePreviewUtil.clampWindow(-5)).toBe(60);
    expect(TelemetryRulePreviewUtil.clampWindow(0)).toBe(60);
    expect(TelemetryRulePreviewUtil.clampWindow(2)).toBe(5);
    expect(TelemetryRulePreviewUtil.clampWindow(299.6)).toBe(300);
  });
});

describe("Reading the server's answer", () => {
  test("every window of the range, in order, with 0 for the windows nothing matched in", () => {
    const answer: TelemetryRulePreviewAnswer = {
      windowInSeconds: 300,
      startTime: "2026-10-27T11:50:00.000Z",
      endTime: "2026-10-27T12:05:00.000Z",
      buckets: [
        { time: "2026-10-27T11:55:00.000Z", value: 7 },
        // ClickHouse's own DateTime text, read as UTC.
        { time: "2026-10-27 12:00:00", value: 3 },
      ],
    };

    expect(
      TelemetryRulePreviewUtil.toPoints(answer).map(
        (point: TelemetryRulePreviewPoint) => {
          return [point.time.toISOString(), point.value];
        },
      ),
    ).toEqual([
      ["2026-10-27T11:50:00.000Z", 0],
      ["2026-10-27T11:55:00.000Z", 7],
      ["2026-10-27T12:00:00.000Z", 3],
    ]);
  });

  test("a count that lands inside a window is added to that window; nonsense times are skipped", () => {
    const answer: TelemetryRulePreviewAnswer = {
      windowInSeconds: 60,
      startTime: "2026-10-27T12:00:00.000Z",
      endTime: "2026-10-27T12:02:00.000Z",
      buckets: [
        { time: "2026-10-27T12:00:00.000Z", value: 2 },
        { time: "2026-10-27T12:00:30.000Z", value: 5 },
        { time: "not a time", value: 100 },
      ],
    };

    expect(
      TelemetryRulePreviewUtil.toPoints(answer).map(
        (point: TelemetryRulePreviewPoint) => {
          return point.value;
        },
      ),
    ).toEqual([7, 0]);
  });

  test("never more points than the preview reads windows", () => {
    const answer: TelemetryRulePreviewAnswer = {
      windowInSeconds: 60,
      startTime: "2026-10-01T00:00:00.000Z",
      endTime: "2026-10-27T00:00:00.000Z",
      buckets: [],
    };

    expect(TelemetryRulePreviewUtil.toPoints(answer)).toHaveLength(
      PREVIEW_WINDOW_COUNT,
    );
  });
});

describe("What the rule makes of the windows", () => {
  test("matched windows, and how many times it would have opened something", () => {
    const summary: TelemetryRulePreviewSummary =
      TelemetryRulePreviewUtil.summarize({
        points: points([1, 12, 15, 3, 2, 30, 4, 11]),
        filterType: FilterType.GreaterThan,
        threshold: 10,
      });

    expect(summary).toEqual({
      windowCount: 8,
      matchedWindowCount: 4,
      // 12,15 then 30 then 11: three runs.
      timesItWouldHaveFired: 3,
      highest: 30,
      lowest: 1,
      typical: 4,
      latest: 11,
    });
  });

  test("a rule for too few: 'no logs' matches the empty windows", () => {
    const summary: TelemetryRulePreviewSummary =
      TelemetryRulePreviewUtil.summarize({
        points: points([5, 0, 0, 4, 0]),
        filterType: FilterType.EqualTo,
        threshold: 0,
      });

    expect(summary.matchedWindowCount).toBe(3);
    expect(summary.timesItWouldHaveFired).toBe(2);
  });

  test("an anomaly, or a rule without a value, matches nothing in the preview", () => {
    expect(
      TelemetryRulePreviewUtil.summarize({
        points: points([100, 200]),
        filterType: FilterType.AnomalouslyHigh,
        threshold: undefined,
      }).matchedWindowCount,
    ).toBe(0);
    expect(
      TelemetryRulePreviewUtil.summarize({
        points: points([100, 200]),
        filterType: FilterType.GreaterThan,
        threshold: undefined,
      }).matchedWindowCount,
    ).toBe(0);
  });

  test("no windows: nothing matched, nothing latest", () => {
    expect(
      TelemetryRulePreviewUtil.summarize({
        points: [],
        filterType: FilterType.GreaterThan,
        threshold: 1,
      }),
    ).toEqual({
      windowCount: 0,
      matchedWindowCount: 0,
      timesItWouldHaveFired: 0,
      highest: 0,
      lowest: 0,
      typical: 0,
      latest: undefined,
    });
  });
});

describe("A suggested threshold", () => {
  test("for too many: above the busiest window, rounded, so the rule would have stayed quiet", () => {
    const busy: Array<TelemetryRulePreviewPoint> = points([3, 5, 23, 4, 6]);
    const suggested: number | undefined =
      TelemetryRulePreviewUtil.suggestThreshold({
        points: busy,
        filterType: FilterType.GreaterThan,
      });

    expect(suggested).toBe(28);
    expect(
      TelemetryRulePreviewUtil.summarize({
        points: busy,
        filterType: FilterType.GreaterThan,
        threshold: suggested,
      }).matchedWindowCount,
    ).toBe(0);

    const atLeast: number | undefined =
      TelemetryRulePreviewUtil.suggestThreshold({
        points: busy,
        filterType: FilterType.GreaterThanOrEqualTo,
      });

    expect(
      TelemetryRulePreviewUtil.summarize({
        points: busy,
        filterType: FilterType.GreaterThanOrEqualTo,
        threshold: atLeast,
      }).matchedWindowCount,
    ).toBe(0);
  });

  test("a quiet scope still suggests at least 1", () => {
    expect(
      TelemetryRulePreviewUtil.suggestThreshold({
        points: points([0, 0, 0]),
        filterType: FilterType.GreaterThan,
      }),
    ).toBe(1);
  });

  test("for too few: half the quietest window, none when a window was already empty", () => {
    expect(
      TelemetryRulePreviewUtil.suggestThreshold({
        points: points([40, 52, 38]),
        filterType: FilterType.LessThan,
      }),
    ).toBe(19);
    expect(
      TelemetryRulePreviewUtil.suggestThreshold({
        points: points([40, 0, 38]),
        filterType: FilterType.LessThan,
      }),
    ).toBeUndefined();
  });

  test("none for an exact value, an anomaly, or no data", () => {
    for (const filterType of [
      FilterType.EqualTo,
      FilterType.NotEqualTo,
      FilterType.AnomalouslyHigh,
      undefined,
    ]) {
      expect(
        TelemetryRulePreviewUtil.suggestThreshold({
          points: points([1, 2, 3]),
          filterType,
        }),
      ).toBeUndefined();
    }

    expect(
      TelemetryRulePreviewUtil.suggestThreshold({
        points: [],
        filterType: FilterType.GreaterThan,
      }),
    ).toBeUndefined();
  });

  test("rounded to a number people write", () => {
    expect(TelemetryRulePreviewUtil.roundUp(9.2)).toBe(10);
    expect(TelemetryRulePreviewUtil.roundUp(27.6)).toBe(28);
    expect(TelemetryRulePreviewUtil.roundUp(1480.8)).toBe(1500);
    expect(TelemetryRulePreviewUtil.roundUp(120)).toBe(120);
    expect(TelemetryRulePreviewUtil.roundUp(121)).toBe(130);
    expect(TelemetryRulePreviewUtil.roundUp(0)).toBe(0);
    expect(TelemetryRulePreviewUtil.roundUp(Number.NaN)).toBe(0);
  });
});
