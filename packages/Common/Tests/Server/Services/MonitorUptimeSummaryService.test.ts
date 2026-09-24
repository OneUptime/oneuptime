/** @timezone UTC */

import MonitorStatusTimelineService, {
  RollingUptimeTotalRow,
  RollingUptimeWindowRequest,
  Service as MonitorStatusTimelineServiceType,
} from "../../../Server/Services/MonitorStatusTimelineService";
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
 * overview's uptime summary from two reads of the timeline: one
 * getDailyUptimeAggregate call for the 90 day bars, and one
 * getRollingUptimeTotals statement for all the rolling windows (24h, 7d,
 * 30d). The project's statuses come alongside.
 *
 * Both SQL statements are replaced here. The bar aggregate is a fake that
 * cuts the requested window into local calendar days the way the SQL does
 * (first bucket clipped to the window start, last bucket clipped to the
 * window end, a DST day 23 or 25 hours long). The rolling statement is
 * answered through a stubbed repository with rows shaped like its result.
 * So what is under test is the service: which windows it asks for, in which
 * zone, and how it puts the answers together. The rolling SQL itself was
 * checked against Postgres (see getRollingUptimeTotals).
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
const DEGRADED_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const SECONDS_24H: number = 86400;
const SECONDS_7D: number = 604800;
const SECONDS_30D: number = 2592000;

// Matches a bind placeholder such as $3.
const PLACEHOLDER: RegExp = /\$(\d+)/g;

interface AggregateRequest {
  monitorIds: Array<ObjectID>;
  startDate: Date;
  endDate: Date;
  timezone?: string | undefined;
}

/*
 * How many seconds of each bucket (bars) or of each window (rolling) the
 * fakes report as down. Keyed by the start instant, so every window can be
 * told apart in the sums.
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

/*
 * What the rolling statement returns for a fully covered monitor: per
 * window, one row per status, the window's own length, and the seconds
 * keyed in downSecondsByStart as down.
 */
function fakeRollingRows(
  params: Array<unknown>,
  downSecondsByStart: DownSecondsByStart,
): Array<RollingUptimeTotalRow> {
  const endMs: number = (params[1] as Date).getTime();
  const keys: Array<string> = params[2] as Array<string>;
  const starts: Array<string> = params[3] as Array<string>;
  const rows: Array<RollingUptimeTotalRow> = [];

  keys.forEach((key: string, index: number): void => {
    const startMs: number = new Date(starts[index]!).getTime();
    const windowSeconds: number = (endMs - startMs) / 1000;
    const downSeconds: number = Math.min(
      downSecondsByStart.get(startMs) || 0,
      windowSeconds,
    );

    rows.push({
      windowKey: key,
      windowSeconds: windowSeconds,
      monitorStatusId: UP_ID.toString(),
      seconds: windowSeconds - downSeconds,
    });

    if (downSeconds > 0) {
      rows.push({
        windowKey: key,
        windowSeconds: windowSeconds,
        monitorStatusId: DOWN_ID.toString(),
        seconds: downSeconds,
      });
    }
  });

  return rows;
}

/*
 * PostgreSQL takes a statement's parameter count from the HIGHEST $n in it,
 * and cannot type a hole below that. Checked on every rolling query issued
 * here, so the placeholders and the bound array cannot drift apart.
 */
function assertBindable(sql: string, params: Array<unknown>): void {
  const referenced: Set<number> = new Set<number>();
  let highest: number = 0;

  for (const match of sql.matchAll(PLACEHOLDER)) {
    const index: number = Number(match[1]);
    referenced.add(index);
    highest = Math.max(highest, index);
  }

  for (let index: number = 1; index <= highest; index++) {
    if (!referenced.has(index)) {
      throw new Error(`could not determine data type of parameter $${index}`);
    }
  }

  if (params.length !== highest) {
    throw new Error(
      `bind message supplies ${params.length} parameters, but prepared statement "" requires ${highest}`,
    );
  }
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

function durationsOf(
  window: MonitorUptimeWindowTotal,
): Array<{ id: string; seconds: number }> {
  return window.statusDurations.map(
    (duration: UptimeStatusDuration): { id: string; seconds: number } => {
      return {
        id: duration.monitorStatusId.toString(),
        seconds: duration.seconds,
      };
    },
  );
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
  let rollingQuery: jest.Mock;
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

    rollingQuery = jest.fn(
      async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<RollingUptimeTotalRow>> => {
        assertBindable(sql, params);
        return fakeRollingRows(params, downSecondsByStart);
      },
    );

    jest.spyOn(MonitorStatusTimelineService, "getRepository").mockReturnValue({
      manager: { query: rollingQuery },
    } as unknown as ReturnType<
      typeof MonitorStatusTimelineService.getRepository
    >);

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

  function rollingParams(): Array<unknown> {
    expect(rollingQuery).toHaveBeenCalledTimes(1);

    return rollingQuery.mock.calls[0]![1] as Array<unknown>;
  }

  it("reads the timeline twice: one bar aggregate call and one rolling-window query", async () => {
    // 23:30 on 20 September in New York.
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    await MonitorStatusTimelineService.getMonitorUptimeSummary({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      timezone: "America/New_York",
      now: now,
    });

    /*
     * The rolling windows used to be three more aggregate calls, each of
     * which read the monitor's whole history.
     */
    expect(aggregateSpy).toHaveBeenCalledTimes(1);

    const bars: AggregateRequest = requests()[0]!;

    // The bars: local midnight on 23 June, 89 days before 20 September.
    expect(bars.startDate.toISOString()).toBe("2026-06-23T04:00:00.000Z");
    expect(bars.endDate.getTime()).toBe(now.getTime());
    expect(bars.timezone).toBe("America/New_York");
    expect(
      bars.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_ID.toString()]);

    const params: Array<unknown> = rollingParams();

    expect(params[0]).toBe(MONITOR_ID.toString());
    // Every window ends at the same instant as the bars.
    expect((params[1] as Date).getTime()).toBe(now.getTime());
    expect(params[2]).toEqual(["24h", "7d", "30d"]);
    // Exact second counts back from now, whatever the zone.
    expect(params[3]).toEqual([
      "2026-09-20T03:30:00.000Z",
      "2026-09-14T03:30:00.000Z",
      "2026-08-22T03:30:00.000Z",
    ]);
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
    expect((rollingParams()[3] as Array<string>)[1]).toBe(
      "2026-03-22T23:30:00.000Z",
    );
    expect(
      windowFor(summary, MonitorUptimeWindowKey.Last7Days).windowSeconds,
    ).toBe(SECONDS_7D);
  });

  it("each rolling window gets its own row of the rolling query", async () => {
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
      downSeconds: number;
    }> = [
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        seconds: SECONDS_24H,
        downSeconds: 10,
      },
      {
        key: MonitorUptimeWindowKey.Last7Days,
        seconds: SECONDS_7D,
        downSeconds: 20,
      },
      {
        key: MonitorUptimeWindowKey.Last30Days,
        seconds: SECONDS_30D,
        downSeconds: 30,
      },
    ];

    for (const expectation of expectations) {
      const window: MonitorUptimeWindowTotal = windowFor(
        summary,
        expectation.key,
      );

      expect(window.startDate.getTime()).toBe(
        now.getTime() - expectation.seconds * 1000,
      );
      expect(window.endDate.getTime()).toBe(now.getTime());
      expect(window.windowSeconds).toBe(expectation.seconds);
      expect(window.coveredSeconds).toBe(expectation.seconds);
      // Not the bars' 40 seconds per day, and not another window's figure.
      expect(durationsOf(window)).toEqual([
        {
          id: UP_ID.toString(),
          seconds: expectation.seconds - expectation.downSeconds,
        },
        { id: DOWN_ID.toString(), seconds: expectation.downSeconds },
      ]);
    }
  });

  it("maps the rolling query's rows to the right windows, whatever order they arrive in", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    rollingQuery.mockResolvedValue([
      // The pg driver can hand numbers back as strings.
      {
        windowKey: "30d",
        windowSeconds: "2592000",
        monitorStatusId: DOWN_ID.toString(),
        seconds: "3000.5",
      },
      // Nothing overlapped the last 24 hours: the LEFT JOIN's NULL row.
      {
        windowKey: "24h",
        windowSeconds: 86400,
        monitorStatusId: null,
        seconds: 0,
      },
      {
        windowKey: "7d",
        windowSeconds: 604800,
        monitorStatusId: DOWN_ID.toString(),
        seconds: 4800,
      },
      {
        windowKey: "30d",
        windowSeconds: "2592000",
        monitorStatusId: UP_ID.toString(),
        seconds: "2588999.5",
      },
      // A status that took no time is not a duration.
      {
        windowKey: "7d",
        windowSeconds: 604800,
        monitorStatusId: DEGRADED_ID.toString(),
        seconds: 0,
      },
      {
        windowKey: "7d",
        windowSeconds: 604800,
        monitorStatusId: UP_ID.toString(),
        seconds: 600000,
      },
      // A key nobody asked for; the 90d window comes from the bars.
      {
        windowKey: "90d",
        windowSeconds: 1,
        monitorStatusId: DOWN_ID.toString(),
        seconds: 1,
      },
    ] as Array<RollingUptimeTotalRow>);

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: now,
      });

    const day: MonitorUptimeWindowTotal = windowFor(
      summary,
      MonitorUptimeWindowKey.Last24Hours,
    );

    // Unmeasured, but still a 24 hour window: the page reads it as No data.
    expect(day.windowSeconds).toBe(SECONDS_24H);
    expect(day.coveredSeconds).toBe(0);
    expect(day.statusDurations).toEqual([]);
    expect(day.startDate.toISOString()).toBe("2026-09-20T03:30:00.000Z");

    const week: MonitorUptimeWindowTotal = windowFor(
      summary,
      MonitorUptimeWindowKey.Last7Days,
    );

    expect(week.windowSeconds).toBe(SECONDS_7D);
    expect(week.coveredSeconds).toBe(604800);
    // Largest first, the order a legend wants.
    expect(durationsOf(week)).toEqual([
      { id: UP_ID.toString(), seconds: 600000 },
      { id: DOWN_ID.toString(), seconds: 4800 },
    ]);
    expect(week.startDate.toISOString()).toBe("2026-09-14T03:30:00.000Z");

    const month: MonitorUptimeWindowTotal = windowFor(
      summary,
      MonitorUptimeWindowKey.Last30Days,
    );

    expect(month.windowSeconds).toBe(SECONDS_30D);
    expect(month.coveredSeconds).toBe(SECONDS_30D);
    expect(durationsOf(month)).toEqual([
      { id: UP_ID.toString(), seconds: 2588999.5 },
      { id: DOWN_ID.toString(), seconds: 3000.5 },
    ]);
    expect(month.startDate.toISOString()).toBe("2026-08-22T03:30:00.000Z");

    const ninety: MonitorUptimeWindowTotal = windowFor(
      summary,
      MonitorUptimeWindowKey.Last90Days,
    );

    expect(ninety.coveredSeconds).toBe(
      summary.buckets.reduce((total: number, bucket: UptimeDayBucket) => {
        return total + bucket.coveredSeconds;
      }, 0),
    );
    expect(secondsIn(ninety.statusDurations, DOWN_ID)).toBe(0);
    expect(summary.windows).toHaveLength(4);
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
    expect(
      secondsIn(
        windowFor(summary, MonitorUptimeWindowKey.Last30Days).statusDurations,
        DOWN_ID,
      ),
    ).toBe(999);
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
        return {
          ...fakeAggregate(request, downSecondsByStart),
          isComplete: false,
          completeFrom: completeFrom,
        };
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

  it("a monitor with no timeline rows gives empty bars and zero coverage, never full coverage", async () => {
    const now: Date = new Date("2026-09-21T03:30:00.000Z");

    aggregateSpy.mockResolvedValue({
      monitors: [],
      isComplete: true,
      completeFrom: null,
    });

    // What the rolling SQL returns when nothing overlaps: one NULL row each.
    rollingQuery.mockImplementation(
      async (
        _sql: string,
        params: Array<unknown>,
      ): Promise<Array<RollingUptimeTotalRow>> => {
        return fakeRollingRows(params, downSecondsByStart).map(
          (row: RollingUptimeTotalRow): RollingUptimeTotalRow => {
            return { ...row, monitorStatusId: null, seconds: 0 };
          },
        );
      },
    );

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: now,
      });

    expect(summary.buckets).toEqual([]);
    expect(summary.windows).toHaveLength(4);

    for (const window of summary.windows) {
      expect(window.coveredSeconds).toBe(0);
      expect(window.statusDurations).toEqual([]);
    }

    expect(
      windowFor(summary, MonitorUptimeWindowKey.Last30Days).windowSeconds,
    ).toBe(SECONDS_30D);
  });

  it("a rolling query that returns no rows at all gives empty windows, not full ones", async () => {
    rollingQuery.mockResolvedValue([]);

    const summary: MonitorUptimeSummary =
      await MonitorStatusTimelineService.getMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        timezone: "UTC",
        now: new Date("2026-09-21T03:30:00.000Z"),
      });

    for (const key of [
      MonitorUptimeWindowKey.Last24Hours,
      MonitorUptimeWindowKey.Last7Days,
      MonitorUptimeWindowKey.Last30Days,
    ]) {
      const window: MonitorUptimeWindowTotal = windowFor(summary, key);

      expect(window.windowSeconds).toBe(0);
      expect(window.coveredSeconds).toBe(0);
      expect(window.statusDurations).toEqual([]);
    }
  });
});

describe("MonitorStatusTimelineService.toRollingUptimeTotals", () => {
  const END: Date = new Date("2026-09-21T03:30:00.000Z");

  function request(
    key: MonitorUptimeWindowKey,
    seconds: number,
  ): RollingUptimeWindowRequest {
    return {
      key: key,
      startDate: new Date(END.getTime() - seconds * 1000),
    };
  }

  it("returns one total per window asked for, in the order asked", () => {
    const totals: Array<MonitorUptimeWindowTotal> =
      MonitorStatusTimelineServiceType.toRollingUptimeTotals({
        rows: [
          {
            windowKey: "24h",
            windowSeconds: 86400,
            monitorStatusId: UP_ID.toString(),
            seconds: 86400,
          },
          {
            windowKey: "30d",
            windowSeconds: 2592000,
            monitorStatusId: DOWN_ID.toString(),
            seconds: 60,
          },
          {
            windowKey: "30d",
            windowSeconds: 2592000,
            monitorStatusId: UP_ID.toString(),
            seconds: 2591940,
          },
        ],
        windows: [
          request(MonitorUptimeWindowKey.Last30Days, SECONDS_30D),
          request(MonitorUptimeWindowKey.Last24Hours, SECONDS_24H),
        ],
        endDate: END,
      });

    expect(
      totals.map((total: MonitorUptimeWindowTotal) => {
        return {
          key: total.key,
          start: total.startDate.toISOString(),
          end: total.endDate.toISOString(),
          windowSeconds: total.windowSeconds,
          coveredSeconds: total.coveredSeconds,
          durations: durationsOf(total),
        };
      }),
    ).toEqual([
      {
        key: MonitorUptimeWindowKey.Last30Days,
        start: "2026-08-22T03:30:00.000Z",
        end: END.toISOString(),
        windowSeconds: SECONDS_30D,
        coveredSeconds: SECONDS_30D,
        durations: [
          { id: UP_ID.toString(), seconds: 2591940 },
          { id: DOWN_ID.toString(), seconds: 60 },
        ],
      },
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        start: "2026-09-20T03:30:00.000Z",
        end: END.toISOString(),
        windowSeconds: SECONDS_24H,
        coveredSeconds: SECONDS_24H,
        durations: [{ id: UP_ID.toString(), seconds: 86400 }],
      },
    ]);
  });

  it("treats numbers that are not finite and non-negative as zero", () => {
    const totals: Array<MonitorUptimeWindowTotal> =
      MonitorStatusTimelineServiceType.toRollingUptimeTotals({
        rows: [
          {
            windowKey: "7d",
            windowSeconds: "not a number",
            monitorStatusId: UP_ID.toString(),
            seconds: "NaN",
          },
          {
            windowKey: "7d",
            windowSeconds: "not a number",
            monitorStatusId: DOWN_ID.toString(),
            seconds: -5,
          },
        ],
        windows: [request(MonitorUptimeWindowKey.Last7Days, SECONDS_7D)],
        endDate: END,
      });

    expect(totals).toHaveLength(1);
    expect(totals[0]!.windowSeconds).toBe(0);
    expect(totals[0]!.coveredSeconds).toBe(0);
    expect(totals[0]!.statusDurations).toEqual([]);
  });

  it("the service does not query at all when no window is asked for", async () => {
    const getRepository: jest.SpyInstance = jest.spyOn(
      MonitorStatusTimelineService,
      "getRepository",
    );

    await expect(
      MonitorStatusTimelineService.getRollingUptimeTotals({
        monitorId: MONITOR_ID,
        windows: [],
        endDate: END,
      }),
    ).resolves.toEqual([]);
    expect(getRepository).not.toHaveBeenCalled();

    getRepository.mockRestore();
  });
});
