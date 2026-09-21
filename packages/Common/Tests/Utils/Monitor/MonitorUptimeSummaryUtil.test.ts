import { Moment } from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  MONITOR_UPTIME_HISTORY_DAYS,
  MONITOR_UPTIME_ROLLING_WINDOWS,
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import MonitorUptimeSummaryUtil, {
  MonitorUptimeCaveat,
  UptimeWindowPresentation,
} from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * The overview's uptime numbers used to be summed in the browser from a
 * capped row fetch, and a day with no rows read as 100%. These pin the rules
 * that replace that: no coverage is "No data", partial coverage says so, and
 * "100%" means exactly zero downtime.
 */

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const OPERATIONAL_ID: string = "22222222-2222-4222-8222-222222222222";
const DEGRADED_ID: string = "33333333-3333-4333-8333-333333333333";
const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";

const STATUSES: Array<MonitorUptimeSummaryStatus> = [
  {
    id: new ObjectID(OPERATIONAL_ID),
    name: "Operational",
    color: "#10B981",
    isOperationalState: true,
    isOfflineState: false,
    priority: 1,
  },
  {
    id: new ObjectID(DEGRADED_ID),
    name: "Degraded",
    color: "#F59E0B",
    isOperationalState: false,
    isOfflineState: false,
    priority: 2,
  },
  {
    id: new ObjectID(OFFLINE_ID),
    name: "Offline",
    color: "#EF4444",
    isOperationalState: false,
    isOfflineState: true,
    priority: 3,
  },
];

const DOWNTIME_IDS: Set<string> =
  MonitorUptimeSummaryUtil.getDowntimeStatusIds(STATUSES);

const bucket: (data: {
  start: string;
  end: string;
  daySeconds: number;
  coveredSeconds: number;
  durations: Array<[string, number]>;
}) => UptimeDayBucket = (data: {
  start: string;
  end: string;
  daySeconds: number;
  coveredSeconds: number;
  durations: Array<[string, number]>;
}): UptimeDayBucket => {
  return {
    bucketStart: new Date(data.start),
    bucketEnd: new Date(data.end),
    daySeconds: data.daySeconds,
    coveredSeconds: data.coveredSeconds,
    statusDurations: data.durations.map((entry: [string, number]) => {
      return { monitorStatusId: new ObjectID(entry[0]), seconds: entry[1] };
    }),
  };
};

const windowTotal: (data: {
  windowSeconds: number;
  coveredSeconds: number;
  durations: Array<[string, number]>;
}) => MonitorUptimeWindowTotal = (data: {
  windowSeconds: number;
  coveredSeconds: number;
  durations: Array<[string, number]>;
}): MonitorUptimeWindowTotal => {
  return {
    key: MonitorUptimeWindowKey.Last30Days,
    startDate: new Date("2026-08-22T12:00:00.000Z"),
    endDate: new Date("2026-09-21T12:00:00.000Z"),
    windowSeconds: data.windowSeconds,
    coveredSeconds: data.coveredSeconds,
    statusDurations: data.durations.map((entry: [string, number]) => {
      return { monitorStatusId: new ObjectID(entry[0]), seconds: entry[1] };
    }),
  };
};

const present: (
  totals: MonitorUptimeWindowTotal,
  isPausedNow?: boolean,
) => UptimeWindowPresentation = (
  totals: MonitorUptimeWindowTotal,
  isPausedNow?: boolean,
): UptimeWindowPresentation => {
  const result: UptimeWindowPresentation | null =
    MonitorUptimeSummaryUtil.getWindowPresentation({
      window: totals,
      downtimeStatusIds: DOWNTIME_IDS,
      isPausedNow: Boolean(isPausedNow),
    });

  if (!result) {
    throw new Error("expected a presentation");
  }

  return result;
};

const THIRTY_DAYS: number = 30 * 86400;

const SUMMARY: MonitorUptimeSummary = {
  monitorId: new ObjectID(MONITOR_ID),
  timezone: "Europe/London",
  generatedAt: new Date("2026-09-21T12:00:00.000Z"),
  startDate: new Date("2026-06-23T23:00:00.000Z"),
  endDate: new Date("2026-09-21T12:00:00.000Z"),
  buckets: [
    bucket({
      start: "2026-09-19T23:00:00.000Z",
      end: "2026-09-20T23:00:00.000Z",
      daySeconds: 86400,
      coveredSeconds: 86400,
      durations: [
        [OPERATIONAL_ID, 86000],
        [OFFLINE_ID, 400],
      ],
    }),
    bucket({
      start: "2026-09-20T23:00:00.000Z",
      end: "2026-09-21T12:00:00.000Z",
      daySeconds: 46800,
      coveredSeconds: 46800,
      durations: [[OPERATIONAL_ID, 46800]],
    }),
  ],
  windows: [
    windowTotal({
      windowSeconds: THIRTY_DAYS,
      coveredSeconds: THIRTY_DAYS,
      durations: [[OPERATIONAL_ID, THIRTY_DAYS]],
    }),
  ],
  isComplete: false,
  completeFrom: new Date("2026-07-01T00:00:00.000Z"),
  statuses: STATUSES,
};

describe("MonitorUptimeSummary types", () => {
  it("has 90 days of history and three exact rolling windows", () => {
    expect(MONITOR_UPTIME_HISTORY_DAYS).toBe(90);
    expect(
      MONITOR_UPTIME_ROLLING_WINDOWS.map(
        (rolling: { key: MonitorUptimeWindowKey; seconds: number }) => {
          return [rolling.key, rolling.seconds];
        },
      ),
    ).toEqual([
      ["24h", 86400],
      ["7d", 604800],
      ["30d", 2592000],
    ]);
  });
});

describe("MonitorUptimeSummaryUtil.sumBuckets", () => {
  it("sumBuckets merges durations across clipped buckets", () => {
    const total: MonitorUptimeWindowTotal = MonitorUptimeSummaryUtil.sumBuckets(
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        startDate: new Date("2026-09-20T12:00:00.000Z"),
        endDate: new Date("2026-09-21T12:00:00.000Z"),
        buckets: [
          // Clipped to the window start: 11 hours of a local day.
          bucket({
            start: "2026-09-20T12:00:00.000Z",
            end: "2026-09-20T23:00:00.000Z",
            daySeconds: 39600,
            coveredSeconds: 39600,
            durations: [
              [OPERATIONAL_ID, 39000],
              [DEGRADED_ID, 600],
            ],
          }),
          // Clipped to now: 13 hours.
          bucket({
            start: "2026-09-20T23:00:00.000Z",
            end: "2026-09-21T12:00:00.000Z",
            daySeconds: 46800,
            coveredSeconds: 46000,
            durations: [
              [OPERATIONAL_ID, 45000],
              [OFFLINE_ID, 1000],
            ],
          }),
        ],
      },
    );

    expect(total.key).toBe(MonitorUptimeWindowKey.Last24Hours);
    expect(total.windowSeconds).toBe(86400);
    expect(total.coveredSeconds).toBe(85600);
    expect(
      total.statusDurations.map(
        (duration: { monitorStatusId: ObjectID; seconds: number }) => {
          return [duration.monitorStatusId.toString(), duration.seconds];
        },
      ),
    ).toEqual([
      [OPERATIONAL_ID, 84000],
      [OFFLINE_ID, 1000],
      [DEGRADED_ID, 600],
    ]);
    expect(total.startDate.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(total.endDate.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  it("an empty bucket list is a zero window, not a full one", () => {
    const total: MonitorUptimeWindowTotal = MonitorUptimeSummaryUtil.sumBuckets(
      {
        key: MonitorUptimeWindowKey.Last90Days,
        startDate: new Date("2026-06-23T00:00:00.000Z"),
        endDate: new Date("2026-09-21T12:00:00.000Z"),
        buckets: [],
      },
    );

    expect(total.windowSeconds).toBe(0);
    expect(total.coveredSeconds).toBe(0);
    expect(total.statusDurations).toEqual([]);
  });

  it("ignores negative and non-numeric seconds", () => {
    const total: MonitorUptimeWindowTotal = MonitorUptimeSummaryUtil.sumBuckets(
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        startDate: new Date("2026-09-20T12:00:00.000Z"),
        endDate: new Date("2026-09-21T12:00:00.000Z"),
        buckets: [
          bucket({
            start: "2026-09-20T12:00:00.000Z",
            end: "2026-09-21T12:00:00.000Z",
            daySeconds: 86400,
            coveredSeconds: -5,
            durations: [[OPERATIONAL_ID, Number.NaN]],
          }),
        ],
      },
    );

    expect(total.coveredSeconds).toBe(0);
    expect(total.statusDurations[0]?.seconds).toBe(0);
  });
});

describe("MonitorUptimeSummaryUtil.getWindowPresentation", () => {
  it("returns null for a window the summary does not have", () => {
    expect(
      MonitorUptimeSummaryUtil.getWindowPresentation({
        window: undefined,
        downtimeStatusIds: DOWNTIME_IDS,
        isPausedNow: false,
      }),
    ).toBeNull();
  });

  it("NoData at zero coverage", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: 0,
        durations: [],
      }),
    );

    expect(result.kind).toBe("NoData");
    expect(result.valueText).toBe("No data");
    expect(result.description).toBe("Nothing recorded in this window");
    expect(result.uptimePercent).toBeNull();
    expect(result.valueText).not.toContain("100");
  });

  it("NoData below one covered second, even while paused", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: 0.4,
        durations: [[OPERATIONAL_ID, 0.4]],
      }),
      true,
    );

    expect(result.kind).toBe("NoData");
    expect(result.description).toBe("Nothing recorded in this window");
  });

  it("full coverage and no downtime is exactly 100%", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: THIRTY_DAYS,
        durations: [[OPERATIONAL_ID, THIRTY_DAYS]],
      }),
    );

    expect(result.kind).toBe("Measured");
    expect(result.valueText).toBe("100%");
    expect(result.uptimePercent).toBe(100);
    expect(result.description).toBe("No downtime");
    expect(result.isPartial).toBe(false);
  });

  it("partial below the 60-second tolerance", () => {
    const withinTolerance: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: THIRTY_DAYS - 60,
        durations: [[OPERATIONAL_ID, THIRTY_DAYS - 60]],
      }),
    );

    expect(withinTolerance.isPartial).toBe(false);
    expect(withinTolerance.description).toBe("No downtime");

    // 3 days 4 hours measured, 43 seconds of it offline.
    const covered: number = 3 * 86400 + 4 * 3600;
    const partial: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: covered,
        durations: [
          [OPERATIONAL_ID, covered - 43],
          [OFFLINE_ID, 43],
        ],
      }),
    );

    expect(partial.isPartial).toBe(true);
    expect(partial.description).toBe("Down 43s · measured over 3d 4h");
    expect(partial.downtimeSeconds).toBe(43);
    expect(partial.coveredSeconds).toBe(covered);
    expect(partial.windowSeconds).toBe(THIRTY_DAYS);
  });

  it("partial just past the tolerance", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: THIRTY_DAYS - 61,
        durations: [[OPERATIONAL_ID, THIRTY_DAYS - 61]],
      }),
    );

    expect(result.isPartial).toBe(true);
    expect(result.description).toContain(" · measured over ");
  });

  it("paused suffix", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: THIRTY_DAYS,
        coveredSeconds: THIRTY_DAYS,
        durations: [
          [OPERATIONAL_ID, THIRTY_DAYS - 120],
          [OFFLINE_ID, 120],
        ],
      }),
      true,
    );

    expect(result.description).toBe("Down 2m · includes paused time");
  });

  it("each caveat names the time nothing measured", () => {
    const totals: MonitorUptimeWindowTotal = windowTotal({
      windowSeconds: THIRTY_DAYS,
      coveredSeconds: THIRTY_DAYS,
      durations: [[OPERATIONAL_ID, THIRTY_DAYS]],
    });
    const describeWith: (
      caveat: MonitorUptimeCaveat | null | undefined,
      isPausedNow?: boolean,
    ) => string | undefined = (
      caveat: MonitorUptimeCaveat | null | undefined,
      isPausedNow?: boolean,
    ): string | undefined => {
      return MonitorUptimeSummaryUtil.getWindowPresentation({
        window: totals,
        downtimeStatusIds: DOWNTIME_IDS,
        caveat: caveat,
        isPausedNow: isPausedNow,
      })?.description;
    };

    expect(describeWith("paused")).toBe("No downtime · includes paused time");
    expect(describeWith("not-checking")).toBe(
      "No downtime · includes time with no checks running",
    );
    expect(describeWith("no-results")).toBe(
      "No downtime · no check has completed yet",
    );
    expect(describeWith(null)).toBe("No downtime");

    // isPausedNow is the older spelling of "paused"; a given caveat wins.
    expect(describeWith(undefined, true)).toBe(
      "No downtime · includes paused time",
    );
    expect(describeWith(null, true)).toBe("No downtime");
    expect(describeWith("not-checking", true)).toBe(
      "No downtime · includes time with no checks running",
    );
  });

  it("a window nothing covered has no caveat to add", () => {
    expect(
      MonitorUptimeSummaryUtil.getWindowPresentation({
        window: windowTotal({
          windowSeconds: THIRTY_DAYS,
          coveredSeconds: 0,
          durations: [],
        }),
        downtimeStatusIds: DOWNTIME_IDS,
        caveat: "not-checking",
      })?.description,
    ).toBe("Nothing recorded in this window");
  });

  it("Degraded (non-operational) counts as downtime", () => {
    expect(DOWNTIME_IDS.has(DEGRADED_ID)).toBe(true);
    expect(DOWNTIME_IDS.has(OFFLINE_ID)).toBe(true);
    expect(DOWNTIME_IDS.has(OPERATIONAL_ID)).toBe(false);

    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: 86400,
        coveredSeconds: 86400,
        durations: [
          [OPERATIONAL_ID, 86400 - 864],
          [DEGRADED_ID, 864],
        ],
      }),
    );

    expect(result.downtimeSeconds).toBe(864);
    expect(result.uptimePercent).toBeCloseTo(99, 10);
    expect(result.valueText).toBe("99%");
    expect(result.description).toBe("Down 14m 24s");
  });

  it("time in a status with no downtime flag is not downtime", () => {
    const unknownStatusId: string = "55555555-5555-4555-8555-555555555555";
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: 86400,
        coveredSeconds: 86400,
        durations: [
          [OPERATIONAL_ID, 43200],
          [unknownStatusId, 43200],
        ],
      }),
    );

    expect(result.valueText).toBe("100%");
  });

  it("never reports more downtime than was recorded", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: 86400,
        coveredSeconds: 3600,
        durations: [[OFFLINE_ID, 7200]],
      }),
    );

    expect(result.downtimeSeconds).toBe(3600);
    expect(result.uptimePercent).toBe(0);
    expect(result.valueText).toBe("0%");
  });

  it("a covered fraction like 1999/2000 floors to the value it really is", () => {
    const result: UptimeWindowPresentation = present(
      windowTotal({
        windowSeconds: 2000,
        coveredSeconds: 2000,
        durations: [
          [OPERATIONAL_ID, 1999],
          [OFFLINE_ID, 1],
        ],
      }),
    );

    expect(result.valueText).toBe("99.95%");
  });
});

describe("MonitorUptimeSummaryUtil.formatUptimePercent", () => {
  it('floors (99.9996 → "99.999%")', () => {
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 99.9996,
        downtimeSeconds: 1,
      }),
    ).toBe("99.999%");
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 99.9829,
        downtimeSeconds: 1,
      }),
    ).toBe("99.982%");
  });

  it('never "100%" with any downtime', () => {
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 99.99999999,
        downtimeSeconds: 0.001,
      }),
    ).toBe("99.999%");
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 100,
        downtimeSeconds: 1,
      }),
    ).toBe("99.999%");
  });

  it('"100%" at zero downtime', () => {
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 100,
        downtimeSeconds: 0,
      }),
    ).toBe("100%");
  });

  it("trims zeros", () => {
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 99.95,
        downtimeSeconds: 10,
      }),
    ).toBe("99.95%");
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 98,
        downtimeSeconds: 10,
      }),
    ).toBe("98%");
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: 90.5,
        downtimeSeconds: 10,
      }),
    ).toBe("90.5%");
  });

  it("clamps below zero and survives a non-number", () => {
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: -3,
        downtimeSeconds: 10,
      }),
    ).toBe("0%");
    expect(
      MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: Number.NaN,
        downtimeSeconds: 10,
      }),
    ).toBe("0%");
  });
});

describe("MonitorUptimeSummaryUtil.getWindow", () => {
  it("finds a window by key and returns undefined for a missing one", () => {
    expect(
      MonitorUptimeSummaryUtil.getWindow(
        SUMMARY,
        MonitorUptimeWindowKey.Last30Days,
      )?.coveredSeconds,
    ).toBe(THIRTY_DAYS);
    expect(
      MonitorUptimeSummaryUtil.getWindow(
        SUMMARY,
        MonitorUptimeWindowKey.Last24Hours,
      ),
    ).toBeUndefined();
  });
});

describe("MonitorUptimeSummaryUtil JSON", () => {
  it("toJSON/fromJSON round trip", () => {
    const json: JSONObject = MonitorUptimeSummaryUtil.toJSON(SUMMARY);

    // Plain strings on the wire, not typed envelopes.
    expect(json["monitorId"]).toBe(MONITOR_ID);
    expect(json["startDate"]).toBe("2026-06-23T23:00:00.000Z");

    const parsed: MonitorUptimeSummary | null =
      MonitorUptimeSummaryUtil.fromJSON(JSON.parse(JSON.stringify(json)));

    expect(parsed).not.toBeNull();
    expect(MonitorUptimeSummaryUtil.toJSON(parsed!)).toEqual(json);
    expect(parsed!.monitorId.toString()).toBe(MONITOR_ID);
    expect(parsed!.timezone).toBe("Europe/London");
    expect(parsed!.buckets).toHaveLength(2);
    expect(parsed!.buckets[0]!.statusDurations[1]!.seconds).toBe(400);
    expect(parsed!.windows[0]!.key).toBe(MonitorUptimeWindowKey.Last30Days);
    expect(parsed!.isComplete).toBe(false);
    expect(parsed!.completeFrom?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parsed!.statuses[2]).toEqual(STATUSES[2]);
  });

  it("fromJSON returns null for garbage", () => {
    expect(MonitorUptimeSummaryUtil.fromJSON(null)).toBeNull();
    expect(MonitorUptimeSummaryUtil.fromJSON(undefined)).toBeNull();
    expect(
      MonitorUptimeSummaryUtil.fromJSON("nope" as unknown as JSONObject),
    ).toBeNull();
    expect(
      MonitorUptimeSummaryUtil.fromJSON([] as unknown as JSONObject),
    ).toBeNull();

    const valid: JSONObject = MonitorUptimeSummaryUtil.toJSON(SUMMARY);

    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, monitorId: 42 }),
    ).toBeNull();
    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, startDate: "not a date" }),
    ).toBeNull();
    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, endDate: null }),
    ).toBeNull();
    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, buckets: {} }),
    ).toBeNull();
  });

  it("skips malformed parts without throwing", () => {
    const valid: JSONObject = MonitorUptimeSummaryUtil.toJSON(SUMMARY);

    const parsed: MonitorUptimeSummary | null =
      MonitorUptimeSummaryUtil.fromJSON({
        ...valid,
        buckets: [
          null,
          "bucket",
          { bucketStart: "garbage", bucketEnd: "2026-09-21T00:00:00.000Z" },
          {
            bucketStart: "2026-09-20T00:00:00.000Z",
            bucketEnd: "2026-09-21T00:00:00.000Z",
            daySeconds: "86400",
            coveredSeconds: "lots",
            statusDurations: [
              { monitorStatusId: OFFLINE_ID, seconds: 30 },
              { monitorStatusId: 7, seconds: 30 },
              { seconds: 30 },
              null,
            ],
          },
        ],
        windows: [
          { key: "1y", startDate: "2026-01-01T00:00:00.000Z" },
          {
            key: "7d",
            startDate: "2026-09-14T12:00:00.000Z",
            endDate: "nope",
          },
          {
            key: "24h",
            startDate: "2026-09-20T12:00:00.000Z",
            endDate: "2026-09-21T12:00:00.000Z",
            windowSeconds: 86400,
            coveredSeconds: 86400,
            statusDurations: "none",
          },
        ],
        statuses: [
          { id: OPERATIONAL_ID },
          { name: "No id" },
          {
            id: OFFLINE_ID,
            name: "Offline",
            color: 12,
            isOfflineState: "yes",
            priority: "3",
          },
        ],
        timezone: 5,
        generatedAt: "never",
        completeFrom: "soon",
      });

    expect(parsed).not.toBeNull();
    expect(parsed!.buckets).toHaveLength(1);
    expect(parsed!.buckets[0]!.daySeconds).toBe(86400);
    expect(parsed!.buckets[0]!.coveredSeconds).toBe(0);
    expect(parsed!.buckets[0]!.statusDurations).toHaveLength(1);
    expect(
      parsed!.windows.map((w: MonitorUptimeWindowTotal) => {
        return w.key;
      }),
    ).toEqual([MonitorUptimeWindowKey.Last24Hours]);
    expect(parsed!.windows[0]!.statusDurations).toEqual([]);
    expect(parsed!.statuses).toEqual([
      {
        id: new ObjectID(OFFLINE_ID),
        name: "Offline",
        color: "",
        isOperationalState: false,
        isOfflineState: false,
        priority: null,
      },
    ]);
    expect(parsed!.timezone).toBe("UTC");
    expect(parsed!.generatedAt.toISOString()).toBe(
      parsed!.endDate.toISOString(),
    );
    expect(parsed!.completeFrom).toBeNull();
  });

  it("isComplete is true unless it is literally false", () => {
    const valid: JSONObject = MonitorUptimeSummaryUtil.toJSON(SUMMARY);
    const withoutFlag: JSONObject = { ...valid };
    delete withoutFlag["isComplete"];

    expect(MonitorUptimeSummaryUtil.fromJSON(withoutFlag)!.isComplete).toBe(
      true,
    );
    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, isComplete: "false" })!
        .isComplete,
    ).toBe(true);
    expect(
      MonitorUptimeSummaryUtil.fromJSON({ ...valid, isComplete: false })!
        .isComplete,
    ).toBe(false);
  });
});

describe("MonitorUptimeSummaryUtil.parseTimezone", () => {
  it("accepts Europe/London", () => {
    expect(MonitorUptimeSummaryUtil.parseTimezone("Europe/London")).toBe(
      "Europe/London",
    );
    expect(MonitorUptimeSummaryUtil.parseTimezone("America/New_York")).toBe(
      "America/New_York",
    );
    expect(MonitorUptimeSummaryUtil.parseTimezone("UTC")).toBe("UTC");
  });

  it("returns the canonical spelling of a zone", () => {
    expect(MonitorUptimeSummaryUtil.parseTimezone(" europe/london ")).toBe(
      "Europe/London",
    );
  });

  it("defaults to UTC", () => {
    expect(MonitorUptimeSummaryUtil.parseTimezone(undefined)).toBe("UTC");
    expect(MonitorUptimeSummaryUtil.parseTimezone("")).toBe("UTC");
    expect(MonitorUptimeSummaryUtil.parseTimezone("   ")).toBe("UTC");
    expect(MonitorUptimeSummaryUtil.parseTimezone(42)).toBe("UTC");
    expect(MonitorUptimeSummaryUtil.parseTimezone(["Europe/London"])).toBe(
      "UTC",
    );
  });

  it("rejects Mars/Olympus", () => {
    expect(() => {
      MonitorUptimeSummaryUtil.parseTimezone("Mars/Olympus");
    }).toThrow(BadDataException);
    expect(() => {
      MonitorUptimeSummaryUtil.parseTimezone("Mars/Olympus");
    }).toThrow(
      "timezone must be an IANA time zone name, for example Europe/London.",
    );
  });
});

describe("MonitorUptimeSummaryUtil.getBrowserTimezone", () => {
  it("reads the zone the runtime reports", () => {
    expect(MonitorUptimeSummaryUtil.getBrowserTimezone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
  });

  it("falls back to moment's guess, then UTC, when Intl throws", () => {
    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl here");
    });

    try {
      jest.spyOn(Moment.tz, "guess").mockReturnValue("Europe/Berlin");
      expect(MonitorUptimeSummaryUtil.getBrowserTimezone()).toBe(
        "Europe/Berlin",
      );

      jest.spyOn(Moment.tz, "guess").mockImplementation(() => {
        throw new Error("no guess either");
      });
      expect(MonitorUptimeSummaryUtil.getBrowserTimezone()).toBe("UTC");
    } finally {
      jest.restoreAllMocks();
    }
  });

  /*
   * A browser can carry newer zone data than the bundled moment-timezone.
   * The server refuses a zone it does not know, so sending it would fail
   * the uptime card on every load.
   */
  it("never sends a zone moment does not know", () => {
    const newZone: string = "America/Nowhere_New";

    expect(Moment.tz.zone(newZone)).toBeNull();

    jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      return {
        resolvedOptions: () => {
          return { timeZone: newZone };
        },
      } as unknown as Intl.DateTimeFormat;
    });
    // moment reports the unknown Intl zone on the console as it guesses.
    jest.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    try {
      // Its offset-based guess from the data it has.
      const guessed: string = MonitorUptimeSummaryUtil.getBrowserTimezone();

      expect(guessed).not.toBe(newZone);
      expect(Moment.tz.zone(guessed)).not.toBeNull();
      expect(MonitorUptimeSummaryUtil.parseTimezone(guessed)).toBe(guessed);

      jest.spyOn(Moment.tz, "guess").mockReturnValue("America/Punta_Arenas");
      expect(MonitorUptimeSummaryUtil.getBrowserTimezone()).toBe(
        "America/Punta_Arenas",
      );

      // A guess moment cannot back is no better.
      jest.spyOn(Moment.tz, "guess").mockReturnValue(newZone);
      expect(MonitorUptimeSummaryUtil.getBrowserTimezone()).toBe("UTC");
    } finally {
      jest.restoreAllMocks();
    }
  });
});
