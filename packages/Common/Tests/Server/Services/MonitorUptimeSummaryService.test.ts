/** @timezone UTC */

import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  MONITOR_UPTIME_HISTORY_DAYS,
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import moment from "moment-timezone";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * MonitorStatusTimelineService.getMonitorUptimeSummary builds the monitor
 * overview's uptime summary from getDailyUptimeAggregate: one call for the
 * 90 day bars and one per rolling window (24h, 7d, 30d), plus the project's
 * statuses.
 *
 * The aggregate itself is SQL and is covered elsewhere. Here it is replaced
 * by a fake that cuts the requested window into local calendar days the
 * way the SQL does (first bucket clipped to the window start, last bucket
 * clipped to the window end, a DST day 23 or 25 hours long), so what is
 * under test is the service: which windows it asks for, in which zone, and
 * how it adds the answers up.
 *
 * The process runs in UTC (the pragma above), as the servers do. On a
 * machine in a DST zone, date arithmetic done in the process zone can hide
 * a calendar-day slip that a UTC server would make.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const UP_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const DOWN_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const SECONDS_24H: number = 86400;
const SECONDS_7D: number = 604800;
const SECONDS_30D: number = 2592000;

interface AggregateRequest {
  monitorIds: Array<ObjectID>;
  startDate: Date;
  endDate: Date;
  timezone?: string | undefined;
}

/*
 * How many seconds of each bucket the fake reports as down. Keyed by the
 * request's start instant, so each of the four calls can be told apart in
 * the sums.
 */
type DownSecondsByStart = Map<number, number>;

function fakeAggregate(
  request: AggregateRequest,
  downSecondsByStart: DownSecondsByStart,
): UptimeDailyAggregate {
  const zone: string = request.timezone || "UTC";
  const startMs: number = request.startDate.getTime();
  const endMs: number = request.endDate.getTime();
  const downPerBucket: number = downSecondsByStart.get(startMs) || 0;
  const buckets: Array<UptimeDayBucket> = [];

  let day: moment.Moment = moment.tz(request.startDate, zone).startOf("day");

  while (day.valueOf() < endMs) {
    const nextDay: moment.Moment = day.clone().add(1, "day");
    const bucketStartMs: number = Math.max(day.valueOf(), startMs);
    const bucketEndMs: number = Math.min(nextDay.valueOf(), endMs);
    const daySeconds: number = (bucketEndMs - bucketStartMs) / 1000;
    const downSeconds: number = Math.min(downPerBucket, daySeconds);
    const statusDurations: Array<UptimeStatusDuration> = [
      { monitorStatusId: UP_ID, seconds: daySeconds - downSeconds },
    ];

    if (downSeconds > 0) {
      statusDurations.push({ monitorStatusId: DOWN_ID, seconds: downSeconds });
    }

    buckets.push({
      bucketStart: new Date(bucketStartMs),
      bucketEnd: new Date(bucketEndMs),
      daySeconds: daySeconds,
      coveredSeconds: daySeconds,
      statusDurations: statusDurations,
    });

    day = nextDay;
  }

  return {
    monitors: request.monitorIds.map((monitorId: ObjectID) => {
      return { monitorId: monitorId, buckets: buckets };
    }),
    isComplete: true,
    completeFrom: null,
  };
}

function secondsIn(
  durations: Array<UptimeStatusDuration>,
  statusId: ObjectID,
): number {
  return durations
    .filter((duration: UptimeStatusDuration) => {
      return duration.monitorStatusId.toString() === statusId.toString();
    })
    .reduce((total: number, duration: UptimeStatusDuration) => {
      return total + duration.seconds;
    }, 0);
}

function sumOverBuckets(
  buckets: Array<UptimeDayBucket>,
  statusId: ObjectID,
): number {
  return buckets.reduce((total: number, bucket: UptimeDayBucket) => {
    return total + secondsIn(bucket.statusDurations, statusId);
  }, 0);
}

function windowFor(
  summary: MonitorUptimeSummary,
  key: MonitorUptimeWindowKey,
): MonitorUptimeWindowTotal {
  const window: MonitorUptimeWindowTotal | undefined = summary.windows.find(
    (candidate: MonitorUptimeWindowTotal) => {
      return candidate.key === key;
    },
  );

  expect(window).toBeDefined();

  return window!;
}

function status(data: {
  id?: string | undefined;
  name?: string | undefined;
  color?: Color | undefined;
  isOperationalState?: boolean | undefined;
  isOfflineState?: boolean | undefined;
  priority?: number | undefined;
}): MonitorStatus {
  const monitorStatus: MonitorStatus = new MonitorStatus();

  if (data.id) {
    monitorStatus.id = new ObjectID(data.id);
  }

  if (data.name !== undefined) {
    monitorStatus.name = data.name;
  }

  if (data.color) {
    monitorStatus.color = data.color;
  }

  if (data.isOperationalState !== undefined) {
    monitorStatus.isOperationalState = data.isOperationalState;
  }

  if (data.isOfflineState !== undefined) {
    monitorStatus.isOfflineState = data.isOfflineState;
  }

  if (data.priority !== undefined) {
    monitorStatus.priority = data.priority;
  }

  return monitorStatus;
}

describe("MonitorStatusTimelineService.getMonitorUptimeSummary", () => {
  let aggregateSpy: jest.SpyInstance;
  let statusFindBy: jest.SpyInstance;
  let downSecondsByStart: DownSecondsByStart;

  beforeEach(() => {
    downSecondsByStart = new Map<number, number>();

    aggregateSpy = jest
      .spyOn(MonitorStatusTimelineService, "getDailyUptimeAggregate")
      .mockImplementation(
        async (request: AggregateRequest): Promise<UptimeDailyAggregate> => {
          return fakeAggregate(request, downSecondsByStart);
        },
      );

    statusFindBy = jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function requests(): Array<AggregateRequest> {
    return aggregateSpy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as AggregateRequest;
    });
  }

  it("issues exactly four aggregate calls with the expected windows", async () => {
    // 23:30 on 20 September in New York.
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    await MonitorStatusTimelineService.getMonitorUptimeSummary({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      timezone: "America/New_York",
      now: now,
    });

    expect(aggregateSpy).toHaveBeenCalledTimes(4);

    const windows: Array<{ start: string; end: string }> = requests().map(
      (request: AggregateRequest) => {
        return {
          start: request.startDate.toISOString(),
          end: request.endDate.toISOString(),
        };
      },
    );

    expect(windows).toEqual(
      expect.arrayContaining([
        // The bars: local midnight on 23 June, 89 days before 20 September.
        { start: "2026-06-23T04:00:00.000Z", end: now.toISOString() },
        { start: "2026-09-20T03:30:00.000Z", end: now.toISOString() },
        { start: "2026-09-14T03:30:00.000Z", end: now.toISOString() },
        { start: "2026-08-22T03:30:00.000Z", end: now.toISOString() },
      ]),
    );
    expect(windows).toHaveLength(4);

    for (const request of requests()) {
      expect(
        request.monitorIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([MONITOR_ID.toString()]);
      expect(request.timezone).toBe("America/New_York");
      // The window ends at the same instant for every call.
      expect(request.endDate.getTime()).toBe(now.getTime());
    }
  });

  it("the bars start at local midnight 89 days before now, giving 90 buckets", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "America/New_York",
        now: now,
      });

    expect(summary.startDate.toISOString()).toBe("2026-06-23T04:00:00.000Z");
    expect(summary.buckets).toHaveLength(MONITOR_UPTIME_HISTORY_DAYS);
    expect(summary.buckets[0]!.bucketStart.toISOString()).toBe(
      "2026-06-23T04:00:00.000Z",
    );
    // The last bar is today, cut off at now.
    expect(summary.buckets[89]!.bucketStart.toISOString()).toBe(
      "2026-09-20T04:00:00.000Z",
    );
    expect(summary.buckets[89]!.bucketEnd.toISOString()).toBe(
      now.toISOString(),
    );
  });

  it("cuts the bars in the requested zone, so the same instant starts a different calendar day in UTC", async () => {
    // It is already 21 September in UTC, so the strip starts on 24 June.
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: now,
      });

    expect(summary.startDate.toISOString()).toBe("2026-06-24T00:00:00.000Z");
    expect(summary.buckets).toHaveLength(MONITOR_UPTIME_HISTORY_DAYS);
    expect(summary.timezone).toBe("UTC");
  });

  it("keeps 90 bars when the window crosses a DST change", async () => {
    /*
     * 00:30 on 30 March in London, the night after the clocks went forward.
     * 89 x 24 hours back from here is 23:30 on 30 December, one calendar day
     * too early, which would have given 91 bars. Counting calendar days in
     * the zone lands on 31 December.
     */
    const now: Date = new Date("2026-03-29T23:30:00.000Z");

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "Europe/London",
        now: now,
      });

    expect(summary.startDate.toISOString()).toBe("2025-12-31T00:00:00.000Z");
    expect(summary.buckets).toHaveLength(MONITOR_UPTIME_HISTORY_DAYS);

    // The day the clocks went forward is 23 hours long.
    const dstDay: UptimeDayBucket | undefined = summary.buckets.find(
      (bucket: UptimeDayBucket) => {
        return bucket.bucketStart.toISOString() === "2026-03-29T00:00:00.000Z";
      },
    );
    expect(dstDay?.daySeconds).toBe(23 * 3600);

    // The rolling windows are exact second counts whatever the zone does.
    expect(
      windowFor(summary, MonitorUptimeWindowKey.Last7Days).windowSeconds,
    ).toBe(SECONDS_7D);
  });

  it("rolling windows are summed from their own buckets", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    downSecondsByStart.set(now.getTime() - SECONDS_24H * 1000, 10);
    downSecondsByStart.set(now.getTime() - SECONDS_7D * 1000, 20);
    downSecondsByStart.set(now.getTime() - SECONDS_30D * 1000, 30);
    downSecondsByStart.set(new Date("2026-06-23T04:00:00.000Z").getTime(), 40);

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "America/New_York",
        now: now,
      });

    expect(
      summary.windows.map((window: MonitorUptimeWindowTotal) => {
        return window.key;
      }),
    ).toEqual([
      MonitorUptimeWindowKey.Last24Hours,
      MonitorUptimeWindowKey.Last7Days,
      MonitorUptimeWindowKey.Last30Days,
      MonitorUptimeWindowKey.Last90Days,
    ]);

    const expectations: Array<{
      key: MonitorUptimeWindowKey;
      seconds: number;
      downPerBucket: number;
    }> = [
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        seconds: SECONDS_24H,
        downPerBucket: 10,
      },
      {
        key: MonitorUptimeWindowKey.Last7Days,
        seconds: SECONDS_7D,
        downPerBucket: 20,
      },
      {
        key: MonitorUptimeWindowKey.Last30Days,
        seconds: SECONDS_30D,
        downPerBucket: 30,
      },
    ];

    for (const expectation of expectations) {
      const window: MonitorUptimeWindowTotal = windowFor(
        summary,
        expectation.key,
      );
      const startMs: number = now.getTime() - expectation.seconds * 1000;
      const callIndex: number = requests().findIndex(
        (request: AggregateRequest) => {
          return request.startDate.getTime() === startMs;
        },
      );

      expect(callIndex).toBeGreaterThan(-1);

      const ownBuckets: Array<UptimeDayBucket> = (
        (await aggregateSpy.mock.results[callIndex]!
          .value) as UptimeDailyAggregate
      ).monitors[0]!.buckets;

      expect(window.startDate.getTime()).toBe(startMs);
      expect(window.endDate.getTime()).toBe(now.getTime());
      expect(window.windowSeconds).toBe(expectation.seconds);
      expect(window.coveredSeconds).toBe(expectation.seconds);
      expect(secondsIn(window.statusDurations, DOWN_ID)).toBe(
        expectation.downPerBucket * ownBuckets.length,
      );
      expect(secondsIn(window.statusDurations, DOWN_ID)).toBe(
        sumOverBuckets(ownBuckets, DOWN_ID),
      );
    }
  });

  it("the 90d window equals the sum of the bar buckets", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");
    const barsStart: Date = new Date("2026-06-23T04:00:00.000Z");

    downSecondsByStart.set(barsStart.getTime(), 40);
    // A rolling window with different numbers, which must not leak into 90d.
    downSecondsByStart.set(now.getTime() - SECONDS_30D * 1000, 999);

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "America/New_York",
        now: now,
      });

    const ninety: MonitorUptimeWindowTotal = windowFor(
      summary,
      MonitorUptimeWindowKey.Last90Days,
    );

    const barWindowSeconds: number = summary.buckets.reduce(
      (total: number, bucket: UptimeDayBucket) => {
        return total + bucket.daySeconds;
      },
      0,
    );
    const barCoveredSeconds: number = summary.buckets.reduce(
      (total: number, bucket: UptimeDayBucket) => {
        return total + bucket.coveredSeconds;
      },
      0,
    );

    expect(ninety.windowSeconds).toBe(barWindowSeconds);
    expect(ninety.windowSeconds).toBe(
      (now.getTime() - barsStart.getTime()) / 1000,
    );
    expect(ninety.coveredSeconds).toBe(barCoveredSeconds);
    expect(secondsIn(ninety.statusDurations, DOWN_ID)).toBe(40 * 90);
    expect(secondsIn(ninety.statusDurations, DOWN_ID)).toBe(
      sumOverBuckets(summary.buckets, DOWN_ID),
    );
    expect(secondsIn(ninety.statusDurations, UP_ID)).toBe(
      sumOverBuckets(summary.buckets, UP_ID),
    );
    expect(ninety.startDate.getTime()).toBe(summary.startDate.getTime());
    expect(ninety.endDate.getTime()).toBe(now.getTime());
  });

  it("statuses are read as root, scoped to the project, with only relation-readable columns", async () => {
    await MonitorStatusTimelineService.getMonitorUptimeSummary({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      timezone: "UTC",
      now: new Date("2026-09-21T03:30:00.000Z"),
    });

    expect(statusFindBy).toHaveBeenCalledTimes(1);

    const args: {
      query: { projectId?: ObjectID };
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      skip: number;
      props: { isRoot?: boolean };
    } = statusFindBy.mock.calls[0]![0] as {
      query: { projectId?: ObjectID };
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      skip: number;
      props: { isRoot?: boolean };
    };

    expect(Object.keys(args.query)).toEqual(["projectId"]);
    expect(args.query.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(args.props).toEqual({ isRoot: true });
    expect(args.sort).toEqual({ priority: SortOrder.Ascending });
    expect(args.limit).toBe(LIMIT_PER_PROJECT);
    expect(args.skip).toBe(0);

    const selected: Array<string> = Object.keys(args.select).sort();

    expect(selected).toEqual(
      [
        "_id",
        "color",
        "isOfflineState",
        "isOperationalState",
        "name",
        "priority",
      ].sort(),
    );

    /*
     * The root read is only safe because a timeline read already exposes
     * these columns through its monitorStatus relation. A column added here
     * without canReadOnRelationQuery would disclose something the CRUD
     * read would not.
     */
    const model: MonitorStatus = new MonitorStatus();

    for (const column of selected) {
      expect(args.select[column]).toBe(true);
      expect(model.getTableColumnMetadata(column).canReadOnRelationQuery).toBe(
        true,
      );
    }
  });

  it("maps the statuses to plain values and skips a row without an id", async () => {
    statusFindBy.mockResolvedValue([
      status({
        id: UP_ID.toString(),
        name: "Operational",
        color: new Color("#10b981"),
        isOperationalState: true,
        isOfflineState: false,
        priority: 1,
      }),
      status({
        id: DOWN_ID.toString(),
        name: "Offline",
        isOfflineState: true,
      }),
      status({ name: "No id" }),
    ]);

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: new Date("2026-09-21T03:30:00.000Z"),
      });

    expect(
      summary.statuses.map((summaryStatus: MonitorUptimeSummaryStatus) => {
        return {
          id: summaryStatus.id.toString(),
          name: summaryStatus.name,
          color: summaryStatus.color,
          isOperationalState: summaryStatus.isOperationalState,
          isOfflineState: summaryStatus.isOfflineState,
          priority: summaryStatus.priority,
        };
      }),
    ).toEqual([
      {
        id: UP_ID.toString(),
        name: "Operational",
        color: "#10b981",
        isOperationalState: true,
        isOfflineState: false,
        priority: 1,
      },
      {
        id: DOWN_ID.toString(),
        name: "Offline",
        color: "",
        isOperationalState: false,
        isOfflineState: true,
        priority: null,
      },
    ]);
  });

  it("carries the monitor, zone, dates and completeness of the bar aggregate", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");
    const completeFrom: Date = new Date("2026-08-01T00:00:00.000Z");

    aggregateSpy.mockImplementation(
      async (request: AggregateRequest): Promise<UptimeDailyAggregate> => {
        const aggregate: UptimeDailyAggregate = fakeAggregate(
          request,
          downSecondsByStart,
        );

        // Only the bars' aggregate is incomplete; the rolling ones are not.
        if (request.startDate.toISOString() === "2026-06-24T00:00:00.000Z") {
          return {
            ...aggregate,
            isComplete: false,
            completeFrom: completeFrom,
          };
        }

        return aggregate;
      },
    );

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: now,
      });

    expect(summary.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(summary.timezone).toBe("UTC");
    expect(summary.generatedAt.getTime()).toBe(now.getTime());
    expect(summary.endDate.getTime()).toBe(now.getTime());
    expect(summary.isComplete).toBe(false);
    expect(summary.completeFrom?.toISOString()).toBe(
      completeFrom.toISOString(),
    );
  });

  it("a monitor the aggregate knows nothing about gives empty bars and zero coverage, never full coverage", async () => {
    aggregateSpy.mockResolvedValue({
      monitors: [],
      isComplete: true,
      completeFrom: null,
    });

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: new Date("2026-09-21T03:30:00.000Z"),
      });

    expect(summary.buckets).toEqual([]);
    expect(summary.windows).toHaveLength(4);

    for (const window of summary.windows) {
      expect(window.coveredSeconds).toBe(0);
      expect(window.statusDurations).toEqual([]);
    }
  });
});
