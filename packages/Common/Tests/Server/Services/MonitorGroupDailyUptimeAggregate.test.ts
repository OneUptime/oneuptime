import {
  MINIMUM_GROUP_STATUS_SECONDS,
  MonitorGroupDailyUptimeRow,
  Service as MonitorStatusTimelineServiceType,
} from "../../../Server/Services/MonitorStatusTimelineService";
import ObjectID from "../../../Types/ObjectID";
import UptimeDayGrid from "../../../Utils/Uptime/UptimeDayGrid";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate: how long
 * each monitor GROUP spent in each status each day - the worst status among
 * its monitors at each instant - for the status page's bars (issue #6697).
 *
 * The database is replaced by a stub repository that records the SQL it is
 * handed. The SQL itself runs against Postgres in
 * MonitorGroupDailyUptimePostgres.test.ts; these pin the parts of it that
 * must not drift, and the arithmetic that turns its unions into a day.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const GROUP_X: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const GROUP_Y: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const OPERATIONAL: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const DEGRADED: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const OFFLINE: string = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";

const WINDOW_START: Date = new Date("2026-08-13T12:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-11T12:00:00.000Z");

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

interface StubbedService {
  service: MonitorStatusTimelineServiceType;
  calls: Array<CapturedQuery>;
}

function stubService(rows: Array<unknown> = []): StubbedService {
  const service: MonitorStatusTimelineServiceType =
    new MonitorStatusTimelineServiceType();
  const calls: Array<CapturedQuery> = [];

  const repository: ReturnType<
    MonitorStatusTimelineServiceType["getRepository"]
  > = {
    manager: {
      query: (sql: string, params: Array<unknown>): Promise<Array<unknown>> => {
        calls.push({ sql, params });
        return Promise.resolve(rows);
      },
    },
  } as unknown as ReturnType<MonitorStatusTimelineServiceType["getRepository"]>;

  jest.spyOn(service, "getRepository").mockImplementation(() => {
    return repository;
  });

  return { service, calls };
}

// the SQL on one line, so assertions do not depend on its indentation.
function flatten(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

function request(data?: {
  timezone?: string | undefined;
  rankedMonitorStatusIds?: Array<string> | undefined;
}): Parameters<
  MonitorStatusTimelineServiceType["getMonitorGroupDailyUptimeAggregate"]
>[0] {
  return {
    monitorGroups: [
      {
        monitorGroupId: new ObjectID(GROUP_X),
        monitorIds: [new ObjectID(MONITOR_A), new ObjectID(MONITOR_B)],
      },
      {
        monitorGroupId: new ObjectID(GROUP_Y),
        monitorIds: [new ObjectID(MONITOR_B)],
      },
    ],
    rankedMonitorStatusIds: data?.rankedMonitorStatusIds || [
      OPERATIONAL,
      DEGRADED,
      OFFLINE,
    ],
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    timezone: data?.timezone,
  };
}

/*
 * The src CTE that decides which rows count and where each ends - the
 * window, the end expression, and the WHERE clause - as in
 * MonitorStatusTimelineMergedDowntime.test.ts.
 */
function rowRules(sql: string): {
  start: string;
  end: string;
  where: string;
} {
  const src: RegExpMatchArray | null = sql.match(
    /GREATEST\( t\."startsAt", p\.win_start, (CASE .*? END) \) AS s, (.*?) AS e FROM "MonitorStatusTimeline" t CROSS JOIN params p LEFT JOIN measured mf ON mf\.monitor_id = t\."monitorId" (WHERE .*?) \), \w+ AS \(/,
  );

  expect(src).not.toBeNull();

  return { start: src![1]!, end: src![2]!, where: src![3]! };
}

describe("MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate", () => {
  test("asks nothing for no groups", async () => {
    const stub: StubbedService = stubService();

    const aggregate: MonitorGroupUptimeDailyAggregate =
      await stub.service.getMonitorGroupDailyUptimeAggregate({
        ...request({ timezone: "Asia/Shanghai" }),
        monitorGroups: [],
      });

    expect(stub.calls).toHaveLength(0);
    expect(aggregate).toEqual({ monitorGroups: [], timezone: "Asia/Shanghai" });
  });

  /*
   * Issue #10039: the zone's midnights are worked out with OneUptime's own
   * tz data (UptimeDayGrid) and bound as $5; the zone never reaches
   * Postgres.
   */
  test("binds each group's number beside its monitors, the window, the zone's midnights, the ranked statuses and the group count", async () => {
    const stub: StubbedService = stubService();

    await stub.service.getMonitorGroupDailyUptimeAggregate(
      request({ timezone: "Asia/Shanghai" }),
    );

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.params).toEqual([
      [1, 1, 2],
      [MONITOR_A, MONITOR_B, MONITOR_B],
      WINDOW_START,
      WINDOW_END,
      UptimeDayGrid.getDatabaseParameter({
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        timezone: "Asia/Shanghai",
      }),
      [OPERATIONAL, DEGRADED, OFFLINE],
      2,
    ]);

    // Shanghai's midnights are 16:00 UTC.
    for (const midnight of stub.calls[0]!.params[4] as Array<string>) {
      expect(midnight.slice(11)).toBe("16:00:00.000Z");
    }
    expect(stub.calls[0]!.params).not.toContain("Asia/Shanghai");
  });

  test("cuts days in UTC when no zone is asked for", async () => {
    const stub: StubbedService = stubService();

    const aggregate: MonitorGroupUptimeDailyAggregate =
      await stub.service.getMonitorGroupDailyUptimeAggregate(request());

    const grid: Array<string> = stub.calls[0]!.params[4] as Array<string>;

    expect(grid.length).toBeGreaterThan(2);
    for (const midnight of grid) {
      expect(midnight.slice(11)).toBe("00:00:00.000Z");
    }
    expect(aggregate.timezone).toBe("UTC");
  });

  test("selects, clips and ends rows exactly as getDailyUptimeAggregate does, so a group's bars line up with every monitor's", async () => {
    const group: StubbedService = stubService();
    await group.service.getMonitorGroupDailyUptimeAggregate(request());

    const monitors: StubbedService = stubService();
    await monitors.service.getDailyUptimeAggregate({
      monitorIds: [new ObjectID(MONITOR_A)],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    const groupRules: { start: string; end: string; where: string } = rowRules(
      flatten(group.calls[0]!.sql),
    );
    const monitorRules: { start: string; end: string; where: string } =
      rowRules(flatten(monitors.calls[0]!.sql));

    // A member's time before its first check is no part of the group's (#8960).
    expect(groupRules.start).toBe(monitorRules.start);
    expect(groupRules.end).toBe(monitorRules.end);
    expect(groupRules.end).toContain(
      'LEAD(t."startsAt") OVER ( PARTITION BY t."monitorId" ORDER BY t."startsAt", t."endsAt" NULLS LAST )',
    );
    // the same predicate, over the group's monitors ($2) rather than the aggregate's ($1).
    expect(groupRules.where).toBe(monitorRules.where.replace("$1", "$2"));
  });

  test("cuts the days on the aggregate's grid: local midnights of the zone, found with width_bucket", async () => {
    const stub: StubbedService = stubService();
    await stub.service.getMonitorGroupDailyUptimeAggregate(request());

    const sql: string = flatten(stub.calls[0]!.sql);

    // The grid is bound ($5), worked out with OneUptime's tz data (#10039).
    expect(sql).toContain("grid AS ( SELECT $5::timestamptz[] AS starts )");
    expect(sql).not.toContain("AT TIME ZONE");
    expect(sql).not.toContain("AS tz");
    expect(sql).toContain("width_bucket(src.s, g.starts) AS first_day");
    expect(sql).toContain(
      "width_bucket(src.e - interval '1 microsecond', g.starts) AS last_day",
    );
    // a period inside one day is one segment; only one crossing midnight fans out.
    expect(sql).toContain("FROM periods WHERE first_day = last_day UNION ALL");
    expect(sql).toContain("LATERAL generate_series(pr.first_day, pr.last_day)");
    // the buckets: clipped to the window, and an empty last one left out.
    expect(sql).toContain(
      "GREATEST(g.starts[di], p.win_start) AS bucket_start",
    );
    expect(sql).toContain("LEAST(g.starts[di + 1], p.eff_end) AS bucket_end");
    expect(sql).toContain("WHERE d.bucket_end > d.bucket_start");
  });

  test("merges each level with a running MAX(end) over the periods ranked at or above it, in start order", async () => {
    const stub: StubbedService = stubService();
    await stub.service.getMonitorGroupDailyUptimeAggregate(request());

    const sql: string = flatten(stub.calls[0]!.sql);

    /*
     * Level 1 is every status (rank 1 and up): a period with monitoring
     * off is ranked 0, so it is in no level (issue #7112).
     */
    expect(sql).toContain(
      "MAX(seg_end) FILTER (WHERE status_rank >= 1) OVER earlier AS reached_1",
    );
    expect(sql).toContain(
      "MAX(seg_end) FILTER (WHERE status_rank >= 2) OVER earlier AS reached_2",
    );
    expect(sql).toContain(
      "MAX(seg_end) FILTER (WHERE status_rank >= 3) OVER earlier AS reached_3",
    );
    expect(sql).not.toContain("reached_4");
    expect(sql).toContain(
      "WINDOW earlier AS ( PARTITION BY group_key, day_index ORDER BY seg_start, seg_end ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING )",
    );
    expect(sql).toContain(
      "COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_3, seg_start)))), 0)) FILTER (WHERE status_rank >= 3), 0)",
    );
    // a status ranks by its place in $6, the worst last; one not in it is left out.
    expect(sql).toContain(
      "FROM UNNEST($6::uuid[]) WITH ORDINALITY AS r(status_id, status_rank)",
    );
    expect(sql).toContain("JOIN ranks rk ON rk.status_id = src.status_id");
    // every group asked for comes back, with a bucket for every day.
    expect(sql).toContain(
      "FROM generate_series(1, $7::int) AS gk(group_key) CROSS JOIN days d LEFT JOIN day_unions u",
    );
  });

  test("puts only level numbers into its text, never an id, a name or the zone", async () => {
    const stub: StubbedService = stubService();
    await stub.service.getMonitorGroupDailyUptimeAggregate(
      request({ timezone: "Asia/Shanghai" }),
    );

    const sql: string = stub.calls[0]!.sql;

    for (const value of [
      MONITOR_A,
      MONITOR_B,
      GROUP_X,
      OPERATIONAL,
      OFFLINE,
      "Asia/Shanghai",
    ]) {
      expect(sql).not.toContain(value);
    }
  });

  test("has one level per ranked status, and at least one", () => {
    const levelsIn: (sql: string) => number = (sql: string): number => {
      return (sql.match(/AS reached_\d+/g) || []).length;
    };

    expect(
      levelsIn(
        MonitorStatusTimelineServiceType.getMonitorGroupDailyUptimeAggregateSql(
          { levelCount: 6 },
        ),
      ),
    ).toBe(6);
    expect(
      levelsIn(
        MonitorStatusTimelineServiceType.getMonitorGroupDailyUptimeAggregateSql(
          { levelCount: 0 },
        ),
      ),
    ).toBe(1);
    expect(
      levelsIn(
        MonitorStatusTimelineServiceType.getMonitorGroupDailyUptimeAggregateSql(
          { levelCount: Number.NaN },
        ),
      ),
    ).toBe(1);
  });
});

describe("MonitorStatusTimelineService.toMonitorGroupUptimeDailyAggregate", () => {
  const RANKED: Array<string> = [OPERATIONAL, DEGRADED, OFFLINE];

  function shape(
    rows: Array<MonitorGroupDailyUptimeRow>,
    monitorGroupIds: Array<string> = [GROUP_X, GROUP_Y],
  ): MonitorGroupUptimeDailyAggregate {
    return MonitorStatusTimelineServiceType.toMonitorGroupUptimeDailyAggregate({
      rows: rows,
      monitorGroupIds: monitorGroupIds.map((id: string) => {
        return new ObjectID(id);
      }),
      rankedMonitorStatusIds: RANKED,
      timezone: "Asia/Shanghai",
    });
  }

  function row(data: {
    group: number;
    start: string;
    end: string;
    daySeconds?: number | string | undefined;
    unions: Array<number | string | null> | null;
  }): MonitorGroupDailyUptimeRow {
    return {
      groupKey: data.group,
      bucketStart: new Date(data.start),
      bucketEnd: new Date(data.end),
      daySeconds: data.daySeconds ?? 86400,
      unions: data.unions,
    };
  }

  function secondsOf(bucket: UptimeDayBucket): Record<string, number> {
    const seconds: Record<string, number> = {};

    for (const duration of bucket.statusDurations) {
      seconds[duration.monitorStatusId.toString()] = duration.seconds;
    }

    return seconds;
  }

  test("the time at exactly a level is its union less the next level's, and the coverage is the first union", () => {
    // all day recorded; Degraded or worse for 5 h, Offline for 2 h of them.
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: 1,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        unions: [86400, 18000, 7200],
      }),
    ]);

    const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets[0]!;

    expect(day.coveredSeconds).toBe(86400);
    expect(secondsOf(day)).toEqual({
      [OPERATIONAL]: 68400,
      [DEGRADED]: 10800,
      [OFFLINE]: 7200,
    });
    expect(day.daySeconds).toBe(86400);
    expect(day.bucketStart.toISOString()).toBe("2026-11-05T16:00:00.000Z");
    expect(aggregate.timezone).toBe("Asia/Shanghai");
  });

  test("a status the group spent no time in is left out, even when two sums of doubles differ in their last bits", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: 1,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        // Degraded and Offline cover the same 3600 s; Operational and Degraded the same day.
        unions: [3600.0000000001, 3600, 3600.0000000002],
      }),
    ]);

    const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets[0]!;

    expect(secondsOf(day)).toEqual({ [OFFLINE]: 3600.0000000002 });
    expect(MINIMUM_GROUP_STATUS_SECONDS).toBeLessThan(0.001);
  });

  test("a day nothing of the group overlapped has no coverage and no durations, and is still a day", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: 1,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        unions: null,
      }),
      row({
        group: 1,
        start: "2026-11-06T16:00:00.000Z",
        end: "2026-11-07T16:00:00.000Z",
        unions: [null, null, null],
      }),
    ]);

    expect(aggregate.monitorGroups[0]!.buckets).toEqual([
      {
        bucketStart: new Date("2026-11-05T16:00:00.000Z"),
        bucketEnd: new Date("2026-11-06T16:00:00.000Z"),
        daySeconds: 86400,
        coveredSeconds: 0,
        statusDurations: [],
      },
      {
        bucketStart: new Date("2026-11-06T16:00:00.000Z"),
        bucketEnd: new Date("2026-11-07T16:00:00.000Z"),
        daySeconds: 86400,
        coveredSeconds: 0,
        statusDurations: [],
      },
    ]);
  });

  test("reads the numbers the pg driver hands back as strings", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: "1" as unknown as number,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        daySeconds: "86400",
        unions: ["86400", "0", "0"],
      }),
    ]);

    const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets[0]!;

    expect(day.daySeconds).toBe(86400);
    expect(secondsOf(day)).toEqual({ [OPERATIONAL]: 86400 });
  });

  test("every group asked for comes back, in the order asked, its buckets in time order", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: 2,
        start: "2026-11-06T16:00:00.000Z",
        end: "2026-11-07T16:00:00.000Z",
        unions: [100, 0, 0],
      }),
      row({
        group: 2,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        unions: [200, 0, 0],
      }),
    ]);

    expect(
      aggregate.monitorGroups.map((group: { monitorGroupId: ObjectID }) => {
        return group.monitorGroupId.toString();
      }),
    ).toEqual([GROUP_X, GROUP_Y]);
    expect(aggregate.monitorGroups[0]!.buckets).toEqual([]);
    expect(
      aggregate.monitorGroups[1]!.buckets.map((bucket: UptimeDayBucket) => {
        return bucket.coveredSeconds;
      }),
    ).toEqual([200, 100]);
  });

  test("ignores a row for a group it was not asked about, and one with a date it cannot read", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape(
      [
        row({
          group: 3,
          start: "2026-11-05T16:00:00.000Z",
          end: "2026-11-06T16:00:00.000Z",
          unions: [100, 0, 0],
        }),
        {
          groupKey: 1,
          bucketStart: "not a date",
          bucketEnd: "2026-11-06T16:00:00.000Z",
          daySeconds: 86400,
          unions: [100, 0, 0],
        },
      ],
      [GROUP_X],
    );

    expect(aggregate.monitorGroups).toEqual([
      { monitorGroupId: new ObjectID(GROUP_X), buckets: [] },
    ]);
  });

  test("a day's durations add up to its coverage, never to more", () => {
    const aggregate: MonitorGroupUptimeDailyAggregate = shape([
      row({
        group: 1,
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        unions: [59215.25, 17687.5, 17687.5],
      }),
    ]);

    const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets[0]!;
    const total: number = day.statusDurations.reduce(
      (sum: number, duration: { seconds: number }) => {
        return sum + duration.seconds;
      },
      0,
    );

    expect(total).toBeCloseTo(day.coveredSeconds, 9);
    expect(day.coveredSeconds).toBeLessThanOrEqual(day.daySeconds);
  });
});

/*
 * A day every monitor of a group had its monitoring off (issue #7112): the
 * group was not checked, so the day has no status - as before - and its
 * bars say it was not monitored instead of "no data". The statement keeps
 * the periods that mark monitoring off at rank 0, which no level counts,
 * and returns one more union, of every period, off included; less level
 * 1's union it is the day's time with monitoring off.
 */
describe("a monitor group's time with monitoring off (issue #7112)", () => {
  test("ranks a period with monitoring off 0, below every status, whatever status it holds, and keeps it", async () => {
    const stub: StubbedService = stubService();
    await stub.service.getMonitorGroupDailyUptimeAggregate(request());

    const sql: string = flatten(stub.calls[0]!.sql);

    expect(sql).toContain(
      "CASE WHEN src.is_off THEN 0 ELSE rk.status_rank END AS status_rank",
    );
    // A status not in $6 is still left out, but a period with monitoring off is kept.
    expect(sql).toContain("LEFT JOIN ranks rk ON rk.status_id = src.status_id");
    expect(sql).toContain(
      "WHERE src.e > src.s AND (src.is_off OR rk.status_rank IS NOT NULL)",
    );
    expect(sql).not.toContain("AND NOT src.is_off");
  });

  test("returns the union of every period, monitoring off included, beside the levels", async () => {
    const stub: StubbedService = stubService();
    await stub.service.getMonitorGroupDailyUptimeAggregate(request());

    const sql: string = flatten(stub.calls[0]!.sql);

    expect(sql).toContain("MAX(seg_end) OVER earlier AS reached_all");
    expect(sql).toContain(
      "COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_all, seg_start)))), 0)), 0)::double precision AS union_all",
    );
    expect(sql).toContain('u.union_all AS "unionWithMonitoringOff"');
    // Every status level filters, level 1 too, so none counts rank 0.
    expect(sql).toContain(
      "COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_1, seg_start)))), 0)) FILTER (WHERE status_rank >= 1), 0)",
    );
  });

  const RANKED: Array<string> = [OPERATIONAL, DEGRADED, OFFLINE];

  function shape(
    rows: Array<MonitorGroupDailyUptimeRow>,
  ): MonitorGroupUptimeDailyAggregate {
    return MonitorStatusTimelineServiceType.toMonitorGroupUptimeDailyAggregate({
      rows: rows,
      monitorGroupIds: [new ObjectID(GROUP_X)],
      rankedMonitorStatusIds: RANKED,
      timezone: "UTC",
    });
  }

  function day(data: {
    unions: Array<number | string | null> | null;
    unionWithMonitoringOff?: number | string | null | undefined;
  }): UptimeDayBucket {
    return shape([
      {
        groupKey: 1,
        bucketStart: new Date("2026-11-05T00:00:00.000Z"),
        bucketEnd: new Date("2026-11-06T00:00:00.000Z"),
        daySeconds: 86400,
        unions: data.unions,
        unionWithMonitoringOff: data.unionWithMonitoringOff,
      },
    ]).monitorGroups[0]!.buckets[0]!;
  }

  test("a day every monitor had monitoring off has no coverage, no status and the whole day off", () => {
    const bucket: UptimeDayBucket = day({
      unions: [0, 0, 0],
      unionWithMonitoringOff: 86400,
    });

    expect(bucket.coveredSeconds).toBe(0);
    expect(bucket.statusDurations).toEqual([]);
    expect(bucket.monitoringOffSeconds).toBe(86400);
  });

  test("a day off in part is measured over the checked part, and says how long it was off", () => {
    // Checked for 18 hours, 2 of them Offline; every monitor off for the other 6.
    const bucket: UptimeDayBucket = day({
      unions: [64800, 7200, 7200],
      unionWithMonitoringOff: 86400,
    });

    expect(bucket.coveredSeconds).toBe(64800);
    expect(bucket.monitoringOffSeconds).toBe(21600);
    expect(
      bucket.statusDurations.reduce(
        (sum: number, duration: { seconds: number }) => {
          return sum + duration.seconds;
        },
        0,
      ),
    ).toBe(64800);
  });

  test("a day one monitor was off while another was checked is no time off for the group", () => {
    // The union of every period equals the checked one: someone was checked throughout.
    const bucket: UptimeDayBucket = day({
      unions: [86400, 0, 0],
      unionWithMonitoringOff: 86400,
    });

    expect(bucket.coveredSeconds).toBe(86400);
    expect(bucket.monitoringOffSeconds).toBeUndefined();
  });

  test("less than a microsecond apart is no time off, and a day monitoring was on carries no field", () => {
    expect(
      day({
        unions: [59215.25, 0, 0],
        unionWithMonitoringOff: 59215.25 + MINIMUM_GROUP_STATUS_SECONDS / 2,
      }).monitoringOffSeconds,
    ).toBeUndefined();
    expect(
      Object.keys(
        day({ unions: [86400, 0, 0], unionWithMonitoringOff: 86400 }),
      ),
    ).not.toContain("monitoringOffSeconds");
  });

  test("reads the union the pg driver hands back as a string, and a row from before it as monitored", () => {
    expect(
      day({ unions: ["0", "0", "0"], unionWithMonitoringOff: "3600.5" })
        .monitoringOffSeconds,
    ).toBe(3600.5);
    expect(
      day({ unions: [0, 0, 0], unionWithMonitoringOff: undefined })
        .monitoringOffSeconds,
    ).toBeUndefined();
    expect(
      day({ unions: null, unionWithMonitoringOff: null }).monitoringOffSeconds,
    ).toBeUndefined();
  });
});
