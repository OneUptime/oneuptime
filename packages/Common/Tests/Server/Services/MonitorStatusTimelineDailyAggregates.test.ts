import {
  Service as MonitorStatusTimelineServiceType,
  UptimeDailyAggregateRow,
} from "../../../Server/Services/MonitorStatusTimelineService";
import ObjectID from "../../../Types/ObjectID";
import UptimeDayGrid from "../../../Utils/Uptime/UptimeDayGrid";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The status-page uptime bars used to be painted from raw MonitorStatusTimeline
 * rows fetched under a single `limit: LIMIT_MAX` (10,000) across EVERY monitor
 * on the page, sorted `startsAt DESC`.
 *
 * Measured on a real status page: 254,550 rows matched the 60-day window and
 * 10,000 came back - 3.9%. The oldest surviving row started four days before
 * the request, so 56 of 60 bars were painted from data that had been dropped,
 * and the uptime percentage was computed from the same 3.9%.
 *
 * The cap is GLOBAL across monitors and the sort is newest-first, so a quiet
 * monitor's covering row - which has an OLD startsAt - sorts last and is cut
 * first. On the reporting page, three flapping monitors held 9,995 of the
 * 10,000 slots. The healthier a monitor is, the more likely it loses its whole
 * history to a noisy neighbour.
 *
 * These tests cover the SHAPING half (no database): turning the SQL's
 * (monitor, day, status) rows into buckets, and in particular keeping a
 * no-coverage day distinguishable from a day spent up.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const STATUS_UP: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS_DOWN: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// A row of the daily aggregate's SQL, as toUptimeDailyAggregate reads it.
type Row = UptimeDailyAggregateRow;

function row(
  monitorId: string,
  day: string,
  statusId: string | null,
  seconds: number,
  daySeconds: number = 86400,
): Row {
  const start: Date = new Date(`${day}T00:00:00.000Z`);
  const end: Date = new Date(start.getTime() + daySeconds * 1000);

  return {
    monitorId,
    bucketStart: start,
    bucketEnd: end,
    /* The pg driver returns bigint columns as strings. */
    daySeconds: String(daySeconds),
    monitorStatusId: statusId,
    seconds: String(seconds),
  };
}

function aggregate(rows: Array<Row>): UptimeDailyAggregate {
  return MonitorStatusTimelineServiceType.toUptimeDailyAggregate(rows);
}

function bucketsFor(
  result: UptimeDailyAggregate,
  monitorId: string,
): Array<UptimeDayBucket> {
  const monitor: MonitorUptimeDailyAggregate | undefined = result.monitors.find(
    (m: MonitorUptimeDailyAggregate) => {
      return m.monitorId.toString() === monitorId;
    },
  );

  return monitor ? monitor.buckets : [];
}

describe("MonitorStatusTimelineService.toUptimeDailyAggregate", () => {
  describe("a day with no coverage is not a day spent up", () => {
    test("a NULL-status row yields a bucket with zero coverage and no durations", () => {
      /*
       * This is the LEFT JOIN's "nothing overlapped this day" row. It is the
       * single most important case in this file: before the fix such a day
       * fell through to the status page's defaultBarColor, which is GREEN on
       * 4,642 status pages - the page silently asserting uptime for a period
       * it has no data for.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", null, 0),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.coveredSeconds).toBe(0);
      expect(buckets[0]!.statusDurations).toHaveLength(0);
      expect(buckets[0]!.daySeconds).toBe(86400);
    });

    test("a zero-second status row does not manufacture coverage", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 0),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.coveredSeconds).toBe(0);
      expect(bucketsFor(result, MONITOR_A)[0]!.statusDurations).toHaveLength(0);
    });

    test("a fully covered day is distinguishable from a no-data day", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", null, 0),
        row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets[0]!.coveredSeconds).toBe(0);
      expect(buckets[1]!.coveredSeconds).toBe(86400);
    });
  });

  describe("partial coverage is a real reading, not a no-data day", () => {
    test("the day a monitor was created reports what was measured", () => {
      /*
       * A monitor created at noon has half a day of data. That is a genuine
       * reading of a shorter interval and must render normally - not as
       * no-data, and not penalised for the hours before it existed.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 43200),
      ]);

      const bucket: UptimeDayBucket = bucketsFor(result, MONITOR_A)[0]!;

      expect(bucket.coveredSeconds).toBe(43200);
      expect(bucket.daySeconds).toBe(86400);
      expect(bucket.coveredSeconds).toBeLessThan(bucket.daySeconds);
      expect(bucket.statusDurations).toHaveLength(1);
    });
  });

  describe("multiple statuses in one day", () => {
    test("durations are kept separately and summed into coverage", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 82800),
        row(MONITOR_A, "2026-07-01", STATUS_DOWN, 3600),
      ]);

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.coveredSeconds).toBe(86400);
      expect(buckets[0]!.statusDurations).toHaveLength(2);

      const down: number =
        buckets[0]!.statusDurations.find((d: { monitorStatusId: ObjectID }) => {
          return d.monitorStatusId.toString() === STATUS_DOWN;
        })?.seconds || 0;

      expect(down).toBe(3600);
    });
  });

  describe("day length is never assumed to be 86400", () => {
    test("a clipped first bucket keeps its real length", () => {
      /*
       * The window's first and last buckets are clipped to the window, and a
       * local day crossing a DST boundary is genuinely 23 or 25 hours. Any
       * consumer dividing by a hardcoded 86400 would misreport both.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 45147, 45147),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(45147);
    });

    test("a 23-hour DST day is reported as 82800 seconds", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-03-29", STATUS_UP, 82800, 82800),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(82800);
    });

    test("a 25-hour DST day is reported as 90000 seconds", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-10-25", STATUS_UP, 90000, 90000),
      ]);

      expect(bucketsFor(result, MONITOR_A)[0]!.daySeconds).toBe(90000);
    });
  });

  describe("monitors are kept apart", () => {
    test("a noisy monitor cannot consume a quiet one's buckets", () => {
      /*
       * The shape of the original bug: a global cap let three flapping
       * monitors hold 9,995 of 10,000 slots and starve the quiet ones. The
       * aggregate is per monitor, so a quiet monitor's days survive
       * regardless of what its neighbours are doing.
       */
      const rows: Array<Row> = [];

      for (let i: number = 0; i < 500; i++) {
        rows.push(row(MONITOR_A, "2026-07-01", STATUS_UP, 1));
        rows.push(row(MONITOR_A, "2026-07-01", STATUS_DOWN, 1));
      }

      rows.push(row(MONITOR_B, "2026-07-01", STATUS_UP, 86400));

      const result: UptimeDailyAggregate = aggregate(rows);

      expect(bucketsFor(result, MONITOR_B)).toHaveLength(1);
      expect(bucketsFor(result, MONITOR_B)[0]!.coveredSeconds).toBe(86400);
    });
  });

  describe("output shape", () => {
    test("buckets come back in chronological order whatever order the rows arrive in", () => {
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-03", STATUS_UP, 86400),
        row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
        row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
      ]);

      const starts: Array<number> = bucketsFor(result, MONITOR_A).map(
        (b: UptimeDayBucket) => {
          return b.bucketStart.getTime();
        },
      );

      expect(starts).toEqual([...starts].sort());
    });

    test("bigint columns arriving as strings are coerced to numbers", () => {
      /*
       * The pg driver returns bigint as a string. Left uncoerced, coverage
       * arithmetic would concatenate instead of adding.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 3600),
        row(MONITOR_A, "2026-07-01", STATUS_DOWN, 1800),
      ]);

      const bucket: UptimeDayBucket = bucketsFor(result, MONITOR_A)[0]!;

      expect(typeof bucket.coveredSeconds).toBe("number");
      expect(typeof bucket.daySeconds).toBe("number");
      expect(bucket.coveredSeconds).toBe(5400);
    });

    test("fractional seconds are not rounded away per status group", () => {
      /*
       * Seconds come back as double precision on purpose. An earlier draft
       * cast each (monitor, day, status) sum to a bigint, which loses up to
       * half a second per status - so a fully covered day with two statuses
       * reported 86,399 of 86,400 seconds and looked one second short of
       * complete. Observed against real data, on a day with 21,914 flapping
       * transitions.
       */
      const result: UptimeDailyAggregate = aggregate([
        { ...row(MONITOR_A, "2026-07-01", STATUS_UP, 0), seconds: 86399.6 },
        { ...row(MONITOR_A, "2026-07-01", STATUS_DOWN, 0), seconds: 0.4 },
      ]);

      const bucket: UptimeDayBucket = bucketsFor(result, MONITOR_A)[0]!;

      expect(bucket.coveredSeconds).toBeCloseTo(86400, 5);
      expect(bucket.statusDurations).toHaveLength(2);
    });

    test("an empty result set is complete, not incomplete", () => {
      const result: UptimeDailyAggregate = aggregate([]);

      expect(result.monitors).toHaveLength(0);
      expect(result.isComplete).toBe(true);
      expect(result.completeFrom).toBeNull();
    });

    test("there is no silent cap: the aggregate always declares completeness", () => {
      /*
       * Requirement 4. The old path had a bound that nothing surfaced. These
       * fields exist so a bound added later has to SHOW rather than be
       * absorbed into a green bar.
       */
      const result: UptimeDailyAggregate = aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
      ]);

      expect(result).toHaveProperty("isComplete");
      expect(result).toHaveProperty("completeFrom");
      expect(result.isComplete).toBe(true);
    });
  });

  /*
   * ROOT CAUSE 3 (server half). The buckets are cut in a zone - UTC for the
   * status page, whose payload is one cached response shared by every
   * visitor - and the browser has to draw its bars on the same day
   * boundaries. Before the fix the aggregate did not say which zone that
   * was, so the browser drew the viewer's local days and matched each UTC
   * bucket to whichever local day it started in. toUptimeDailyAggregate took
   * no zone and returned no `timezone`, so every assertion below fails
   * against it.
   */
  describe("the zone the days were cut in travels with the buckets", () => {
    test("rows shaped without a zone make a UTC aggregate", () => {
      expect(
        aggregate([row(MONITOR_A, "2026-07-01", STATUS_UP, 86400)]).timezone,
      ).toBe("UTC");
    });

    test("an empty result set is a UTC aggregate too", () => {
      expect(aggregate([]).timezone).toBe("UTC");
    });

    test("the zone the SQL cut the days in is carried on the aggregate, buckets unchanged", () => {
      const tokyoMidnight: Date = new Date("2026-06-30T15:00:00.000Z");

      const result: UptimeDailyAggregate =
        MonitorStatusTimelineServiceType.toUptimeDailyAggregate(
          [
            {
              ...row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
              bucketStart: tokyoMidnight,
              bucketEnd: new Date(tokyoMidnight.getTime() + 86400 * 1000),
            },
          ],
          "Asia/Tokyo",
        );

      expect(result.timezone).toBe("Asia/Tokyo");

      const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.bucketStart.toISOString()).toBe(
        "2026-06-30T15:00:00.000Z",
      );
      expect(buckets[0]!.coveredSeconds).toBe(86400);
    });

    test("the zone survives the wire format the status page parses", () => {
      const result: UptimeDailyAggregate =
        MonitorStatusTimelineServiceType.toUptimeDailyAggregate(
          [row(MONITOR_A, "2026-07-01", STATUS_UP, 86400)],
          "America/New_York",
        );

      expect(
        UptimeDailyAggregateUtil.fromJSON(
          UptimeDailyAggregateUtil.toJSON(result),
        ).timezone,
      ).toBe("America/New_York");
    });
  });
});

/*
 * The query half, with the database replaced by a stub repository that
 * records the SQL and parameters it is handed and returns canned rows.
 *
 * ROOT CAUSE 4 (server hardening). The LEAD that caps an open row at the
 * next row's start used to order by startsAt alone. A flapping monitor
 * writes rows that tie on startsAt (a backfilled zero-length row next to the
 * open one), and an exact tie is left in whatever order the plan produces.
 * When the OPEN row came first its LEAD was the tied row's startsAt - its own
 * start - so the monitor's current status was cut to zero length and today
 * read as no data. The fix orders `startsAt, endsAt NULLS LAST`, the rule
 * getRollingUptimeTotals and UptimeUtil.compareTimelinesChronologically use.
 */
describe("MonitorStatusTimelineService.getDailyUptimeAggregate", () => {
  interface CapturedQuery {
    sql: string;
    params: Array<unknown>;
  }

  interface StubbedService {
    service: MonitorStatusTimelineServiceType;
    calls: Array<CapturedQuery>;
    getRepositoryCalls: () => number;
  }

  const WINDOW_START: Date = new Date("2026-07-24T12:00:00.000Z");
  const WINDOW_END: Date = new Date("2026-09-22T12:00:00.000Z");

  function stubService(rows: Array<Row> = []): StubbedService {
    const service: MonitorStatusTimelineServiceType =
      new MonitorStatusTimelineServiceType();
    const calls: Array<CapturedQuery> = [];
    let repositoryCalls: number = 0;

    const repository: ReturnType<
      MonitorStatusTimelineServiceType["getRepository"]
    > = {
      manager: {
        query: (sql: string, params: Array<unknown>): Promise<Array<Row>> => {
          calls.push({ sql, params });
          return Promise.resolve(rows);
        },
      },
    } as unknown as ReturnType<
      MonitorStatusTimelineServiceType["getRepository"]
    >;

    /*
     * Stubbed on a fresh instance, so nothing leaks between tests. The real
     * getRepository throws without a database connection.
     */
    jest.spyOn(service, "getRepository").mockImplementation(() => {
      repositoryCalls++;
      return repository;
    });

    return {
      service,
      calls,
      getRepositoryCalls: (): number => {
        return repositoryCalls;
      },
    };
  }

  // the SQL on one line, so assertions do not depend on its indentation.
  function flatten(sql: string): string {
    return sql.replace(/\s+/g, " ");
  }

  test("the LEAD that ends an open row orders by startsAt, then endsAt NULLS LAST", async () => {
    const stub: StubbedService = stubService();

    await stub.service.getDailyUptimeAggregate({
      monitorIds: [new ObjectID(MONITOR_A)],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    expect(stub.calls).toHaveLength(1);

    const sql: string = flatten(stub.calls[0]!.sql);

    // the old SQL read `PARTITION BY t."monitorId" ORDER BY t."startsAt" )`.
    expect(sql).toMatch(
      /LEAD\(t\."startsAt"\) OVER \( PARTITION BY t\."monitorId" ORDER BY t\."startsAt", t\."endsAt" NULLS LAST \)/,
    );
    expect(sql).not.toMatch(/ORDER BY t\."startsAt" \)/);
  });

  /*
   * Issue #6887: each period finds its days on the window's grid of local
   * midnights with width_bucket, as the monitor group statement does,
   * instead of a generate_series of zone conversions per row. The Postgres
   * suite (MonitorDailyUptimeAggregatePostgres.test.ts) holds it to the old
   * statement's buckets in nine zones.
   */
  test("cuts the days on the monitor group's grid of local midnights, found with width_bucket", async () => {
    const stub: StubbedService = stubService();

    await stub.service.getDailyUptimeAggregate({
      monitorIds: [new ObjectID(MONITOR_A)],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    const sql: string = flatten(stub.calls[0]!.sql);

    /*
     * The grid, the same text as the group's: one array of local midnights,
     * bound as a parameter ($4 here, $5 in the group's statement).
     */
    expect(sql).toContain(
      flatten(
        MonitorStatusTimelineServiceType.getDayGridCte({ parameter: "$4" }),
      ),
    );
    expect(
      flatten(
        MonitorStatusTimelineServiceType.getMonitorGroupDailyUptimeAggregateSql(
          { levelCount: 2 },
        ),
      ),
    ).toContain(
      flatten(
        MonitorStatusTimelineServiceType.getDayGridCte({ parameter: "$5" }),
      ),
    );
    expect(sql).toContain("grid AS ( SELECT $4::timestamptz[] AS starts )");

    expect(sql).toContain("width_bucket(src.s, g.starts) AS first_day");
    expect(sql).toContain(
      "width_bucket(src.e - interval '1 microsecond', g.starts) AS last_day",
    );
    /*
     * A period inside one day is one segment; only one crossing midnight
     * fans out. The days come from an integer series in the select list, so
     * the periods are read once: two branches of a UNION over them had
     * Postgres write every period to a temporary file first.
     */
    expect(sql).toContain(
      "generate_series(pr.first_day, pr.last_day) AS day_index FROM periods pr )",
    );
    expect(sql).not.toContain("UNION ALL");
    expect(sql).not.toContain("LATERAL generate_series(pr.first_day");
    expect(sql).toContain(
      "LEAST(sp.e, g.starts[sp.day_index + 1]) - GREATEST(sp.s, g.starts[sp.day_index])",
    );
    expect(sql).toContain(
      "WHERE LEAST(sp.e, g.starts[sp.day_index + 1]) > GREATEST(sp.s, g.starts[sp.day_index])",
    );
    // No zone conversion is made per row any more.
    expect(sql).not.toContain("date_trunc('day', src.s AT TIME ZONE p.tz)");
    expect(sql).not.toContain("AT TIME ZONE p.tz) AS day_start");

    // The buckets are the group's too: clipped to the window, the empty left out.
    expect(sql).toContain(
      flatten(MonitorStatusTimelineServiceType.getDayBucketsCte()),
    );
    expect(sql).toContain(
      "LEFT JOIN agg a ON a.monitor_id = m.monitor_id AND a.day_index = d.day_index",
    );
    expect(sql).toContain("WHERE d.bucket_end > d.bucket_start");
    // A monitor asked for twice is read once, never counted twice.
    expect(sql).toContain("SELECT DISTINCT UNNEST($1::uuid[]) AS monitor_id");
  });

  /*
   * Issue #10039: the requested zone's midnights are worked out with
   * OneUptime's own tz data (UptimeDayGrid) and bound as $4, a
   * timestamptz[]; the zone itself never reaches Postgres, whose zoneinfo
   * OneUptime does not control.
   */
  test("the requested zone's midnights are bound as $4, and the zone itself is not", async () => {
    const stub: StubbedService = stubService();

    await stub.service.getDailyUptimeAggregate({
      monitorIds: [new ObjectID(MONITOR_A), new ObjectID(MONITOR_B)],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
      timezone: "Asia/Tokyo",
    });

    const call: CapturedQuery = stub.calls[0]!;

    expect(flatten(call.sql)).toContain("$4::timestamptz[] AS starts");
    expect(call.sql).not.toContain("AT TIME ZONE");
    expect(call.sql).not.toContain("AS tz");
    expect(call.params).toHaveLength(4);
    expect(call.params[0]).toEqual([MONITOR_A, MONITOR_B]);
    expect(call.params[1]).toBe(WINDOW_START);
    expect(call.params[2]).toBe(WINDOW_END);
    expect(call.params).not.toContain("Asia/Tokyo");
    expect(call.params[3]).toEqual(
      UptimeDayGrid.getDatabaseParameter({
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        timezone: "Asia/Tokyo",
      }),
    );

    // Tokyo's midnights are 15:00 UTC, from the day the window starts in.
    const grid: Array<string> = call.params[3] as Array<string>;

    expect(grid[0]).toBe("2026-07-23T15:00:00.000Z");
    for (const midnight of grid) {
      expect(midnight.slice(11)).toBe("15:00:00.000Z");
    }
    // To the midnight that ends the window's last day, and one day on.
    expect(grid[grid.length - 1]).toBe("2026-09-23T15:00:00.000Z");
  });

  test.each([
    ["not given", undefined],
    ["an empty string", ""],
  ])(
    "a zone that is %s is bound as UTC and the aggregate says UTC",
    async (_name: string, timezone: string | undefined) => {
      const stub: StubbedService = stubService([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 86400),
      ]);

      const result: UptimeDailyAggregate =
        await stub.service.getDailyUptimeAggregate({
          monitorIds: [new ObjectID(MONITOR_A)],
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          timezone: timezone,
        });

      const grid: Array<string> = stub.calls[0]!.params[3] as Array<string>;

      // UTC's midnights, from the day the window starts in.
      expect(grid[0]).toBe("2026-07-24T00:00:00.000Z");
      for (const midnight of grid) {
        expect(midnight.slice(11)).toBe("00:00:00.000Z");
      }
      expect(result.timezone).toBe("UTC");
    },
  );

  test("the returned aggregate carries the zone it was cut in, with the rows shaped into buckets", async () => {
    const tokyoMidnight: Date = new Date("2026-06-30T15:00:00.000Z");

    const stub: StubbedService = stubService([
      {
        ...row(MONITOR_A, "2026-07-01", STATUS_UP, 82800),
        bucketStart: tokyoMidnight,
        bucketEnd: new Date(tokyoMidnight.getTime() + 86400 * 1000),
      },
      {
        ...row(MONITOR_A, "2026-07-01", STATUS_DOWN, 3600),
        bucketStart: tokyoMidnight,
        bucketEnd: new Date(tokyoMidnight.getTime() + 86400 * 1000),
      },
    ]);

    const result: UptimeDailyAggregate =
      await stub.service.getDailyUptimeAggregate({
        monitorIds: [new ObjectID(MONITOR_A)],
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        timezone: "Asia/Tokyo",
      });

    // the old code returned toUptimeDailyAggregate(rows): no timezone at all.
    expect(result.timezone).toBe("Asia/Tokyo");
    expect(result.isComplete).toBe(true);

    const buckets: Array<UptimeDayBucket> = bucketsFor(result, MONITOR_A);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.coveredSeconds).toBe(86400);
    expect(buckets[0]!.statusDurations).toHaveLength(2);
  });

  test.each([
    ["a zone", "America/New_York", "America/New_York"],
    ["no zone", undefined, "UTC"],
  ])(
    "no monitors with %s returns an empty aggregate in that zone without touching the database",
    async (
      _name: string,
      timezone: string | undefined,
      expectedTimezone: string,
    ) => {
      const stub: StubbedService = stubService();

      const result: UptimeDailyAggregate =
        await stub.service.getDailyUptimeAggregate({
          monitorIds: [],
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          timezone: timezone,
        });

      expect(result).toEqual({
        monitors: [],
        isComplete: true,
        completeFrom: null,
        timezone: expectedTimezone,
      });
      expect(stub.calls).toHaveLength(0);
      expect(stub.getRepositoryCalls()).toBe(0);
    },
  );
});

/*
 * TIME WITH MONITORING OFF (issue #7112). Nothing checks a monitor while its
 * monitoring is off, so that time is in no status and out of a day's
 * coverage, as before (issue #6480). The statement now returns it apart,
 * one row per day with no status and isMonitoringOff, so a day that was off
 * says so on the bars instead of reading as a day with no data.
 */
describe("a monitor's time with monitoring off (issue #7112)", () => {
  function offRow(
    monitorId: string,
    day: string,
    seconds: number,
  ): Row & { isMonitoringOff: boolean } {
    return { ...row(monitorId, day, null, seconds), isMonitoringOff: true };
  }

  test("a day monitoring was off has no coverage, no status, and says how long it was off", () => {
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      aggregate([offRow(MONITOR_A, "2026-07-01", 86400)]),
      MONITOR_A,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.coveredSeconds).toBe(0);
    expect(buckets[0]!.statusDurations).toEqual([]);
    expect(buckets[0]!.monitoringOffSeconds).toBe(86400);
  });

  test("a day off in part is measured over the rest", () => {
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      aggregate([
        row(MONITOR_A, "2026-07-01", STATUS_UP, 18 * 3600),
        offRow(MONITOR_A, "2026-07-01", 6 * 3600),
      ]),
      MONITOR_A,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.coveredSeconds).toBe(18 * 3600);
    expect(buckets[0]!.statusDurations).toEqual([
      { monitorStatusId: new ObjectID(STATUS_UP), seconds: 18 * 3600 },
    ]);
    expect(buckets[0]!.monitoringOffSeconds).toBe(6 * 3600);
  });

  test("an off row is never a status, even with a status on it, and its seconds never count as uptime", () => {
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      aggregate([
        {
          ...row(MONITOR_A, "2026-07-01", STATUS_DOWN, 3600),
          isMonitoringOff: true,
        },
      ]),
      MONITOR_A,
    );

    expect(buckets[0]!.coveredSeconds).toBe(0);
    expect(buckets[0]!.statusDurations).toEqual([]);
    expect(buckets[0]!.monitoringOffSeconds).toBe(3600);
  });

  test("a day's off rows add up, and fractions are kept", () => {
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      aggregate([
        offRow(MONITOR_A, "2026-07-01", 1800.25),
        offRow(MONITOR_A, "2026-07-01", 1800.5),
      ]),
      MONITOR_A,
    );

    expect(buckets[0]!.monitoringOffSeconds).toBeCloseTo(3600.75, 9);
  });

  test("a zero-second off row, or a day monitoring was on, carries no field: buckets read as they always did", () => {
    const buckets: Array<UptimeDayBucket> = bucketsFor(
      aggregate([
        offRow(MONITOR_A, "2026-07-01", 0),
        row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
        row(MONITOR_A, "2026-07-03", null, 0),
      ]),
      MONITOR_A,
    );

    for (const bucket of buckets) {
      expect(Object.keys(bucket)).not.toContain("monitoringOffSeconds");
    }
  });

  test("monitors are kept apart: one monitor's time off is not another's", () => {
    const result: UptimeDailyAggregate = aggregate([
      offRow(MONITOR_A, "2026-07-01", 86400),
      row(MONITOR_B, "2026-07-01", STATUS_UP, 86400),
    ]);

    expect(bucketsFor(result, MONITOR_A)[0]!.monitoringOffSeconds).toBe(86400);
    expect(
      bucketsFor(result, MONITOR_B)[0]!.monitoringOffSeconds,
    ).toBeUndefined();
    expect(bucketsFor(result, MONITOR_B)[0]!.coveredSeconds).toBe(86400);
  });

  test("survives the wire format the status page parses, and is written only for a day it was off", () => {
    const result: UptimeDailyAggregate = aggregate([
      offRow(MONITOR_A, "2026-07-01", 21600),
      row(MONITOR_A, "2026-07-01", STATUS_UP, 64800),
      row(MONITOR_A, "2026-07-02", STATUS_UP, 86400),
    ]);

    const json: ReturnType<typeof UptimeDailyAggregateUtil.toJSON> =
      UptimeDailyAggregateUtil.toJSON(result);
    const wireBuckets: Array<Record<string, unknown>> = (
      json["monitors"] as unknown as Array<{
        buckets: Array<Record<string, unknown>>;
      }>
    )[0]!.buckets;

    expect(wireBuckets[0]!["monitoringOffSeconds"]).toBe(21600);
    expect(Object.keys(wireBuckets[1]!)).not.toContain("monitoringOffSeconds");

    const parsed: Array<UptimeDayBucket> =
      UptimeDailyAggregateUtil.fromJSON(json).monitors[0]!.buckets;

    expect(parsed[0]!.monitoringOffSeconds).toBe(21600);
    expect(parsed[0]!.coveredSeconds).toBe(64800);
    expect(parsed[1]!.monitoringOffSeconds).toBeUndefined();
  });

  test("the wire format reads a missing, malformed or negative value as no time off", () => {
    const parse: (value: unknown) => number | undefined = (
      value: unknown,
    ): number | undefined => {
      return UptimeDailyAggregateUtil.bucketsFromJSON([
        {
          bucketStart: "2026-07-01T00:00:00.000Z",
          bucketEnd: "2026-07-02T00:00:00.000Z",
          daySeconds: 86400,
          coveredSeconds: 0,
          statusDurations: [],
          monitoringOffSeconds: value,
        },
      ])[0]!.monitoringOffSeconds;
    };

    expect(parse(undefined)).toBeUndefined();
    expect(parse("not a number")).toBeUndefined();
    expect(parse(-5)).toBeUndefined();
    expect(parse(0)).toBeUndefined();
    expect(parse("7200")).toBe(7200);
  });

  test("the statement keeps a row with monitoring off apart, after the LEAD, with no status", async () => {
    const service: MonitorStatusTimelineServiceType =
      new MonitorStatusTimelineServiceType();
    const calls: Array<string> = [];

    jest.spyOn(service, "getRepository").mockImplementation(() => {
      return {
        manager: {
          query: (sql: string): Promise<Array<Row>> => {
            calls.push(sql);
            return Promise.resolve([]);
          },
        },
      } as unknown as ReturnType<
        MonitorStatusTimelineServiceType["getRepository"]
      >;
    });

    await service.getDailyUptimeAggregate({
      monitorIds: [new ObjectID(MONITOR_A)],
      startDate: new Date("2026-07-24T12:00:00.000Z"),
      endDate: new Date("2026-09-22T12:00:00.000Z"),
    });

    const sql: string = calls[0]!.replace(/\s+/g, " ");

    expect(sql).toContain('t."isMonitoringOff" IS TRUE AS is_off');
    expect(sql).toContain(
      "CASE WHEN src.is_off THEN NULL ELSE src.status_id END AS status_id",
    );
    expect(sql).toContain(
      "GROUP BY sp.monitor_id, sp.day_index, sp.status_id, sp.is_off",
    );
    expect(sql).toContain('COALESCE(a.is_off, false) AS "isMonitoringOff"');
    // Kept, not dropped: the day says it was off instead of having no data.
    expect(sql).not.toContain("AND NOT src.is_off");
  });
});
