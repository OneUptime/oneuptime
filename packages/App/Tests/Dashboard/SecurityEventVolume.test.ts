import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "Common/UI/Components/TelemetryViewer/types";
import {
  SECURITY_EVENT_VOLUME_COLORS,
  SECURITY_EVENT_VOLUME_SEVERITIES,
  SecurityEventSeverityCount,
  SecurityEventVolume,
  buildSecurityEventVolume,
  buildSecurityEventVolumeAggregateBy,
  buildSecurityEventVolumeFromResult,
  getSecurityEventVolumeSeries,
  getSecurityEventVolumeZoomRange,
  intervalForWindow,
  toSecurityEventVolumeSeverity,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// On the minute grid, so the expected slots are easy to reason about.
const WINDOW_END: Date = new Date("2026-09-17T13:00:00.000Z");

function windowOf(spanMs: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(WINDOW_END.getTime() - spanMs),
    endDate: WINDOW_END,
  };
}

function row(
  timestamp: Date | string,
  severityName: unknown,
  value: unknown,
): AggregatedModel {
  return {
    timestamp: timestamp as Date,
    value: value as number,
    severityName: severityName as string,
  };
}

function nonEmpty(volume: SecurityEventVolume): Array<HistogramBucket> {
  return volume.buckets.filter((bucket: HistogramBucket): boolean => {
    return bucket.count > 0;
  });
}

function slotTimes(volume: SecurityEventVolume): Array<string> {
  return Array.from(
    new Set<string>(
      volume.buckets.map((bucket: HistogramBucket): string => {
        return bucket.time;
      }),
    ),
  );
}

function sumOfBuckets(volume: SecurityEventVolume): number {
  return volume.buckets.reduce((sum: number, bucket: HistogramBucket) => {
    return sum + bucket.count;
  }, 0);
}

describe("SecurityEventVolume series", () => {
  test("stacks most severe first, with Other and Unknown on top", () => {
    expect(SECURITY_EVENT_VOLUME_SEVERITIES).toEqual([
      OcsfSeverity.Fatal,
      OcsfSeverity.Critical,
      OcsfSeverity.High,
      OcsfSeverity.Medium,
      OcsfSeverity.Low,
      OcsfSeverity.Informational,
      OcsfSeverity.Other,
      OcsfSeverity.Unknown,
    ]);
  });

  test("covers every OCSF severity exactly once", () => {
    expect([...SECURITY_EVENT_VOLUME_SEVERITIES].sort()).toEqual(
      [...Object.values(OcsfSeverity)].sort(),
    );
  });

  test("series are keyed and labelled by the severity name the rows carry", () => {
    const series: Array<HistogramSeriesOption> = getSecurityEventVolumeSeries();

    expect(
      series.map((option: HistogramSeriesOption): string => {
        return option.key;
      }),
    ).toEqual(SECURITY_EVENT_VOLUME_SEVERITIES);
    for (const option of series) {
      expect(option.label).toBe(option.key);
      expect(option.color).toBe(
        SECURITY_EVENT_VOLUME_COLORS[option.key as OcsfSeverity],
      );
    }
  });

  test("every severity has its own colour, so stacked segments stay distinguishable", () => {
    const colors: Array<string> = Object.values(SECURITY_EVENT_VOLUME_COLORS);

    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("Critical keeps the severity pill's red and High its orange", () => {
    expect(SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Critical]).toBe("#dc2626");
    expect(SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.High]).toBe("#ea580c");
  });
});

describe("toSecurityEventVolumeSeverity", () => {
  test.each(Object.values(OcsfSeverity))(
    "%s counts as itself",
    (name: OcsfSeverity) => {
      expect(toSecurityEventVolumeSeverity(name)).toBe(name);
    },
  );

  test.each([
    ["the column default", ""],
    ["a missing value", undefined],
    ["null", null],
    ["a raw vendor severity", "CRITICAL"],
    ["an unrecognised name", "Severe-ish"],
    ["a number", 5],
  ])(
    "%s counts as Unknown rather than disappearing",
    (_label: unknown, value: unknown) => {
      expect(toSecurityEventVolumeSeverity(value)).toBe(OcsfSeverity.Unknown);
    },
  );
});

describe("buildSecurityEventVolumeAggregateBy", () => {
  const query: Query<SecurityEvent> = {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    time: new InBetween<Date>(
      windowOf(DAY_MS).startDate,
      windowOf(DAY_MS).endDate,
    ),
    severityName: new Includes([OcsfSeverity.High, OcsfSeverity.Critical]),
  };

  const aggregateBy: AggregateBy<SecurityEvent> =
    buildSecurityEventVolumeAggregateBy({
      query: query,
      ...windowOf(DAY_MS),
    });

  test("counts rows over exactly the query the table lists", () => {
    expect(aggregateBy.query).toBe(query);
    expect(aggregateBy.aggregationType).toBe(AggregationType.Count);
    // Non-nullable with a '' default, so count(eventUid) is a row count.
    expect(aggregateBy.aggregateColumnName).toBe("eventUid");
  });

  test("buckets by event time and splits by severity", () => {
    expect(aggregateBy.aggregationTimestampColumnName).toBe("time");
    expect(aggregateBy.groupBy).toEqual({ severityName: true });
  });

  test("leaves the bucket size to the server, derived from the window", () => {
    expect(aggregateBy.aggregationInterval).toBeUndefined();
    expect(aggregateBy.startTimestamp).toEqual(windowOf(DAY_MS).startDate);
    expect(aggregateBy.endTimestamp).toEqual(windowOf(DAY_MS).endDate);
  });

  test("asks for every bucket, oldest first", () => {
    expect(aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(aggregateBy.skip).toBe(0);
    expect(aggregateBy.sort).toEqual({ time: SortOrder.Ascending });
  });

  test("the limit holds every severity in every bucket of the widest grid-aligned window", () => {
    // 3 hours of minute buckets is the densest window the server returns.
    const bucketsIn3Hours: number = 3 * 60 + 1;

    expect(
      bucketsIn3Hours * SECURITY_EVENT_VOLUME_SEVERITIES.length,
    ).toBeLessThan(aggregateBy.limit);
  });
});

describe("intervalForWindow", () => {
  test.each([
    ["1 hour", HOUR_MS, AggregationInterval.Minute],
    ["3 hour", 3 * HOUR_MS, AggregationInterval.Minute],
    ["12 hour", 12 * HOUR_MS, AggregationInterval.FiveMinutes],
    ["1 day", DAY_MS, AggregationInterval.FifteenMinutes],
    ["3 day", 3 * DAY_MS, AggregationInterval.ThirtyMinutes],
    ["1 week", 7 * DAY_MS, AggregationInterval.Hour],
    ["30 day", 30 * DAY_MS, AggregationInterval.Day],
    ["90 day", 90 * DAY_MS, AggregationInterval.Week],
  ])(
    "a %s window buckets by %s, as the server does",
    (_label: unknown, spanMs: unknown, interval: unknown) => {
      const window: { startDate: Date; endDate: Date } = windowOf(
        spanMs as number,
      );

      expect(intervalForWindow(window.startDate, window.endDate)).toBe(
        interval,
      );
    },
  );
});

describe("buildSecurityEventVolume", () => {
  test("an hour window lays out one minute slot per minute, empty ones included", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(HOUR_MS),
    });

    expect(volume.interval).toBe(AggregationInterval.Minute);
    expect(volume.intervalMs).toBe(MINUTE_MS);
    // 12:00 through 13:00 inclusive.
    expect(slotTimes(volume)).toHaveLength(61);
    expect(slotTimes(volume)[0]).toBe("2026-09-17T12:00:00.000Z");
    expect(slotTimes(volume)[60]).toBe("2026-09-17T13:00:00.000Z");
  });

  test("an empty window is all zero-count slots, a zero total and no severities", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(HOUR_MS),
    });

    expect(volume.total).toBe(0);
    expect(volume.countsBySeverity).toEqual([]);
    expect(nonEmpty(volume)).toEqual([]);
    for (const bucket of volume.buckets) {
      expect(bucket.count).toBe(0);
    }
  });

  test("zero-count slots carry a known series key, so they draw nothing and legend nothing", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(HOUR_MS),
    });

    for (const bucket of volume.buckets) {
      expect(SECURITY_EVENT_VOLUME_SEVERITIES).toContain(bucket.series);
    }
  });

  test("puts each count in its bucket under its severity", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-09-17T12:10:00.000Z", OcsfSeverity.High, 3),
        row("2026-09-17T12:10:00.000Z", OcsfSeverity.Critical, 1),
        row("2026-09-17T12:45:00.000Z", OcsfSeverity.Informational, 20),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(nonEmpty(volume)).toEqual([
      {
        time: "2026-09-17T12:10:00.000Z",
        series: OcsfSeverity.Critical,
        count: 1,
      },
      { time: "2026-09-17T12:10:00.000Z", series: OcsfSeverity.High, count: 3 },
      {
        time: "2026-09-17T12:45:00.000Z",
        series: OcsfSeverity.Informational,
        count: 20,
      },
    ]);
  });

  test("a bucket with events carries no zero-count filler beside them", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [row("2026-09-17T12:10:00.000Z", OcsfSeverity.Low, 2)],
      ...windowOf(HOUR_MS),
    });

    expect(
      volume.buckets.filter((bucket: HistogramBucket): boolean => {
        return bucket.time === "2026-09-17T12:10:00.000Z";
      }),
    ).toEqual([
      { time: "2026-09-17T12:10:00.000Z", series: OcsfSeverity.Low, count: 2 },
    ]);
  });

  test("buckets are oldest first and severity-ordered within a bucket", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-09-17T12:50:00.000Z", OcsfSeverity.Unknown, 1),
        row("2026-09-17T12:50:00.000Z", OcsfSeverity.Fatal, 1),
        row("2026-09-17T12:05:00.000Z", OcsfSeverity.Medium, 1),
      ],
      ...windowOf(HOUR_MS),
    });

    const times: Array<number> = volume.buckets.map(
      (bucket: HistogramBucket): number => {
        return new Date(bucket.time).getTime();
      },
    );
    expect(
      [...times].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(times);
    expect(
      nonEmpty(volume)
        .filter((bucket: HistogramBucket): boolean => {
          return bucket.time === "2026-09-17T12:50:00.000Z";
        })
        .map((bucket: HistogramBucket): string => {
          return bucket.series;
        }),
    ).toEqual([OcsfSeverity.Fatal, OcsfSeverity.Unknown]);
  });

  test("totals per severity follow severity order and skip empty severities", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-09-17T12:10:00.000Z", OcsfSeverity.Informational, 7),
        row("2026-09-17T12:20:00.000Z", OcsfSeverity.Critical, 2),
        row("2026-09-17T12:30:00.000Z", OcsfSeverity.Critical, 3),
        row("2026-09-17T12:40:00.000Z", OcsfSeverity.Low, 4),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(volume.countsBySeverity).toEqual([
      {
        severity: OcsfSeverity.Critical,
        count: 5,
        color: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Critical],
      },
      {
        severity: OcsfSeverity.Low,
        count: 4,
        color: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Low],
      },
      {
        severity: OcsfSeverity.Informational,
        count: 7,
        color: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Informational],
      },
    ]);
    expect(volume.total).toBe(16);
  });

  test("the total is the sum of the bars and of the per-severity totals", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-09-17T12:01:00.000Z", OcsfSeverity.High, 11),
        row("2026-09-17T12:02:00.000Z", OcsfSeverity.Medium, 5),
        row("2026-09-17T12:02:00.000Z", "", 9),
        row("2026-09-17T12:59:00.000Z", OcsfSeverity.Other, 1),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(volume.total).toBe(26);
    expect(sumOfBuckets(volume)).toBe(26);
    expect(
      volume.countsBySeverity.reduce(
        (sum: number, item: SecurityEventSeverityCount) => {
          return sum + item.count;
        },
        0,
      ),
    ).toBe(26);
  });

  test("unrecognised severities in one bucket add up under Unknown", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-09-17T12:10:00.000Z", "", 2),
        row("2026-09-17T12:10:00.000Z", "WARNING", 3),
        row("2026-09-17T12:10:00.000Z", OcsfSeverity.Unknown, 1),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(nonEmpty(volume)).toEqual([
      {
        time: "2026-09-17T12:10:00.000Z",
        series: OcsfSeverity.Unknown,
        count: 6,
      },
    ]);
    expect(volume.countsBySeverity).toEqual([
      {
        severity: OcsfSeverity.Unknown,
        count: 6,
        color: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Unknown],
      },
    ]);
  });

  test("reads ClickHouse's stringified UInt64 counts", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [row("2026-09-17T12:10:00.000Z", OcsfSeverity.High, "42")],
      ...windowOf(HOUR_MS),
    });

    expect(volume.total).toBe(42);
  });

  test("accepts bucket timestamps as Dates as well as the ISO strings the API sends", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row(new Date("2026-09-17T12:10:00.000Z"), OcsfSeverity.High, 1),
        row("2026-09-17T12:10:00.000Z", OcsfSeverity.High, 1),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(nonEmpty(volume)).toEqual([
      { time: "2026-09-17T12:10:00.000Z", series: OcsfSeverity.High, count: 2 },
    ]);
  });

  test.each([
    ["an unparseable timestamp", row("not a date", OcsfSeverity.High, 5)],
    ["a missing timestamp", row(undefined as unknown as string, "High", 5)],
    ["a zero count", row("2026-09-17T12:10:00.000Z", OcsfSeverity.High, 0)],
    ["a negative count", row("2026-09-17T12:10:00.000Z", "High", -3)],
    ["a non-numeric count", row("2026-09-17T12:10:00.000Z", "High", "lots")],
  ])("ignores a row with %s", (_label: unknown, badRow: unknown) => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        badRow as AggregatedModel,
        row("2026-09-17T12:20:00.000Z", OcsfSeverity.Low, 1),
      ],
      ...windowOf(HOUR_MS),
    });

    expect(volume.total).toBe(1);
    expect(nonEmpty(volume)).toEqual([
      { time: "2026-09-17T12:20:00.000Z", series: OcsfSeverity.Low, count: 1 },
    ]);
  });

  test("a day window lays out quarter-hour slots on the server's grid", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      // A start off the grid: the first slot is the one it falls in.
      startDate: new Date("2026-09-16T13:07:30.000Z"),
      endDate: new Date("2026-09-17T13:07:30.000Z"),
    });

    expect(volume.interval).toBe(AggregationInterval.FifteenMinutes);
    expect(volume.intervalMs).toBe(15 * MINUTE_MS);
    expect(slotTimes(volume)[0]).toBe("2026-09-16T13:00:00.000Z");
    expect(slotTimes(volume)[slotTimes(volume).length - 1]).toBe(
      "2026-09-17T13:00:00.000Z",
    );
    expect(slotTimes(volume)).toHaveLength(97);
    for (const time of slotTimes(volume)) {
      expect(new Date(time).getTime() % (15 * MINUTE_MS)).toBe(0);
    }
  });

  test("a count stamped inside a slot lands on that slot, not beside it", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [row("2026-09-17T10:07:00.000Z", OcsfSeverity.High, 4)],
      ...windowOf(DAY_MS),
    });

    expect(nonEmpty(volume)).toEqual([
      { time: "2026-09-17T10:00:00.000Z", series: OcsfSeverity.High, count: 4 },
    ]);
    expect(slotTimes(volume)).toHaveLength(97);
  });

  test("a week window buckets by the hour", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(7 * DAY_MS),
    });

    expect(volume.interval).toBe(AggregationInterval.Hour);
    expect(slotTimes(volume)).toHaveLength(7 * 24 + 1);
  });

  test("a month window buckets by the day", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(30 * DAY_MS),
    });

    expect(volume.interval).toBe(AggregationInterval.Day);
    expect(slotTimes(volume)).toHaveLength(31);
  });

  test("calendar-snapped intervals draw the server's buckets as they come, with no filler", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-06-01T00:00:00.000Z", OcsfSeverity.High, 3),
        row("2026-08-01T00:00:00.000Z", OcsfSeverity.Low, 2),
      ],
      ...windowOf(365 * DAY_MS),
    });

    expect(volume.interval).toBe(AggregationInterval.Month);
    expect(volume.buckets).toEqual([
      { time: "2026-06-01T00:00:00.000Z", series: OcsfSeverity.High, count: 3 },
      { time: "2026-08-01T00:00:00.000Z", series: OcsfSeverity.Low, count: 2 },
    ]);
  });

  test("never lays out an unbounded number of slots", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...windowOf(42 * DAY_MS),
    });

    expect(volume.interval).toBe(AggregationInterval.Day);
    expect(volume.buckets.length).toBeLessThanOrEqual(43);
  });

  test("from an aggregate result, and from one with no data array", () => {
    const window: { startDate: Date; endDate: Date } = windowOf(HOUR_MS);

    expect(
      buildSecurityEventVolumeFromResult({
        result: {
          data: [row("2026-09-17T12:10:00.000Z", OcsfSeverity.High, 3)],
        },
        ...window,
      }).total,
    ).toBe(3);
    expect(
      buildSecurityEventVolumeFromResult({
        result: {} as unknown as { data: Array<AggregatedModel> },
        ...window,
      }).total,
    ).toBe(0);
  });
});

describe("getSecurityEventVolumeZoomRange", () => {
  const FIFTEEN_MINUTES: number = 15 * MINUTE_MS;

  test("keeps the last bucket the drag covered, not just its start", () => {
    expect(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T10:00:00.000Z"),
        endDate: new Date("2026-09-17T11:00:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
      }),
    ).toEqual({
      startDate: new Date("2026-09-17T10:00:00.000Z"),
      endDate: new Date("2026-09-17T11:15:00.000Z"),
    });
  });

  test("a drag that stays in one bucket zooms into that bucket, not a zero-width window", () => {
    const zoomed: { startDate: Date; endDate: Date } =
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T10:00:00.000Z"),
        endDate: new Date("2026-09-17T10:00:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
      });

    expect(zoomed.endDate.getTime() - zoomed.startDate.getTime()).toBe(
      FIFTEEN_MINUTES,
    );
  });

  test("a right-to-left drag zooms the same as left-to-right", () => {
    expect(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T11:00:00.000Z"),
        endDate: new Date("2026-09-17T10:00:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
      }),
    ).toEqual(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T10:00:00.000Z"),
        endDate: new Date("2026-09-17T11:00:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
      }),
    );
  });

  test("never runs past the end of the window it zooms out of", () => {
    expect(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T12:30:00.000Z"),
        endDate: new Date("2026-09-17T12:45:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
        windowEndDate: new Date("2026-09-17T12:52:10.000Z"),
      }).endDate,
    ).toEqual(new Date("2026-09-17T12:52:10.000Z"));
  });

  test("ignores a window end that would leave nothing to show", () => {
    expect(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T12:30:00.000Z"),
        endDate: new Date("2026-09-17T12:45:00.000Z"),
        intervalMs: FIFTEEN_MINUTES,
        windowEndDate: new Date("2026-09-17T12:00:00.000Z"),
      }).endDate,
    ).toEqual(new Date("2026-09-17T13:00:00.000Z"));
  });

  test("with no bucket size known it zooms to exactly the dragged labels", () => {
    expect(
      getSecurityEventVolumeZoomRange({
        startDate: new Date("2026-09-17T10:00:00.000Z"),
        endDate: new Date("2026-09-17T11:00:00.000Z"),
        intervalMs: 0,
      }).endDate,
    ).toEqual(new Date("2026-09-17T11:00:00.000Z"));
  });
});
