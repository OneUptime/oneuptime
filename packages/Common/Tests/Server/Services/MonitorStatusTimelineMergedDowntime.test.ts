import {
  MergedDowntimeRow,
  MergedDowntimeTotals,
  Service as MonitorStatusTimelineServiceType,
} from "../../../Server/Services/MonitorStatusTimelineService";
import { MonitorUptimeWindowKey } from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * MonitorStatusTimelineService.getMergedDowntimeSeconds: how long a SET of
 * monitors was down - the time at least one of them was in a downtime
 * status - and how long at least one of them was recorded.
 *
 * The status page report's page and group downtime and a monitor group's
 * uptime used to be merged from timeline rows fetched under one 10,000 row
 * cap across the whole page, newest first, so on a page with a flapping
 * monitor they covered only the newest few days. The per-monitor day
 * aggregate has no cap but cannot say when at least one of several monitors
 * was down, so the merge has its own query.
 *
 * The database is replaced by a stub repository that records the SQL it is
 * handed. The SQL itself was checked against a real Postgres; these tests
 * pin the parts of it that must not drift, and the shaping of its one row.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DEGRADED: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const WINDOW_START: Date = new Date("2026-07-24T12:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-22T12:00:00.000Z");

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

interface StubbedService {
  service: MonitorStatusTimelineServiceType;
  calls: Array<CapturedQuery>;
  getRepositoryCalls: () => number;
}

function stubService(rows: Array<unknown> = []): StubbedService {
  const service: MonitorStatusTimelineServiceType =
    new MonitorStatusTimelineServiceType();
  const calls: Array<CapturedQuery> = [];
  let repositoryCalls: number = 0;

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

async function mergedSql(): Promise<string> {
  const stub: StubbedService = stubService([
    { coveredSeconds: 0, downtimeSeconds: 0 },
  ]);

  await stub.service.getMergedDowntimeSeconds({
    monitorIds: [new ObjectID(MONITOR_A)],
    downtimeMonitorStatusIds: [OFFLINE],
    startDate: WINDOW_START,
    endDate: WINDOW_END,
  });

  return flatten(stub.calls[0]!.sql);
}

async function aggregateSql(): Promise<string> {
  const stub: StubbedService = stubService();

  await stub.service.getDailyUptimeAggregate({
    monitorIds: [new ObjectID(MONITOR_A)],
    startDate: WINDOW_START,
    endDate: WINDOW_END,
  });

  return flatten(stub.calls[0]!.sql);
}

/*
 * The parts of a src CTE that decide which rows count and where each starts
 * and ends: the window, the cut at the monitor's first check (issue #8960),
 * the end expression, the join that reads the first check, and the WHERE
 * clause.
 */
function rowRules(sql: string): {
  window: string;
  start: string;
  end: string;
  measuredJoin: string;
  where: string;
} {
  const window: RegExpMatchArray | null = sql.match(
    /WITH params AS \( SELECT (\$2::timestamptz AS win_start, LEAST\(\$3::timestamptz, now\(\)\) AS eff_end)/,
  );
  const src: RegExpMatchArray | null = sql.match(
    /GREATEST\( t\."startsAt", p\.win_start, (CASE .*? END) \) AS s, (.*?) AS e FROM "MonitorStatusTimeline" t CROSS JOIN params p (LEFT JOIN measured mf ON mf\.monitor_id = t\."monitorId") (WHERE .*?) \), \w+ AS \(/,
  );

  expect(window).not.toBeNull();
  expect(src).not.toBeNull();

  return {
    window: window![1]!,
    start: src![1]!,
    end: src![2]!,
    measuredJoin: src![3]!,
    where: src![4]!,
  };
}

describe("MonitorStatusTimelineService.getMergedDowntimeSeconds", () => {
  test("selects, clips and ends rows exactly as getDailyUptimeAggregate does", async () => {
    /*
     * For one monitor the two queries must agree, and each monitor's day
     * figure in the report sits next to merged ones. If either query's row
     * rules change, both have to.
     */
    const merged: ReturnType<typeof rowRules> = rowRules(await mergedSql());
    const aggregate: ReturnType<typeof rowRules> = rowRules(
      await aggregateSql(),
    );

    expect(merged).toEqual(aggregate);

    // Both leave a monitor's time before its first check out (#8960).
    expect(merged.start).toContain("mf.measured_from");
    expect(merged.measuredJoin).toBe(
      'LEFT JOIN measured mf ON mf.monitor_id = t."monitorId"',
    );

    expect(merged.end).toContain(
      'LEAD(t."startsAt") OVER ( PARTITION BY t."monitorId" ORDER BY t."startsAt", t."endsAt" NULLS LAST )',
    );
    expect(merged.where).toBe(
      'WHERE t."monitorId" = ANY($1::uuid[]) AND t."deletedAt" IS NULL AND t."startsAt" <= p.eff_end AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)',
    );
  });

  test("picks out downtime statuses only after the LEAD has seen every row", async () => {
    /*
     * Filtered before the LEAD, an open Offline row would run on to the next
     * Offline row's start, across the Operational rows in between.
     */
    const sql: string = await mergedSql();

    expect(rowRules(sql).where).not.toContain("$4");
    expect(sql.match(/\$4/g)).toHaveLength(1);
    expect(
      sql.indexOf("status_id = ANY($4::uuid[]) AS is_downtime"),
    ).toBeGreaterThan(sql.indexOf("LEAD("));
  });

  test("merges with a running MAX(end) over the periods before each, in start order", async () => {
    const sql: string = await mergedSql();

    expect(sql).toContain("MAX(e) OVER earlier AS covered_until");
    expect(sql).toContain(
      "MAX(e) FILTER (WHERE is_downtime) OVER earlier AS down_until",
    );
    expect(sql).toContain(
      "WINDOW earlier AS ( ORDER BY s, e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING )",
    );

    // each period adds only what it reaches past the ones before it.
    expect(sql).toContain(
      "EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(covered_until, s))))",
    );
    expect(sql).toContain(
      "EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(down_until, s))))",
    );
  });

  test("binds the monitors, the window and the downtime statuses", async () => {
    const stub: StubbedService = stubService([
      { coveredSeconds: 86400, downtimeSeconds: 3600 },
    ]);

    await stub.service.getMergedDowntimeSeconds({
      monitorIds: [new ObjectID(MONITOR_A), new ObjectID(MONITOR_B)],
      downtimeMonitorStatusIds: [new ObjectID(OFFLINE), DEGRADED],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.params).toEqual([
      [MONITOR_A, MONITOR_B],
      WINDOW_START,
      WINDOW_END,
      [OFFLINE, DEGRADED],
    ]);
  });

  test("returns what the database measured", async () => {
    const stub: StubbedService = stubService([
      { coveredSeconds: 5184000, downtimeSeconds: 16800.5 },
    ]);

    const totals: MergedDowntimeTotals =
      await stub.service.getMergedDowntimeSeconds({
        monitorIds: [new ObjectID(MONITOR_A)],
        downtimeMonitorStatusIds: [OFFLINE],
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      });

    expect(totals).toEqual({
      coveredSeconds: 5184000,
      downtimeSeconds: 16800.5,
    });
  });

  test("answers zero for no monitors without touching the database", async () => {
    const stub: StubbedService = stubService();

    const totals: MergedDowntimeTotals =
      await stub.service.getMergedDowntimeSeconds({
        monitorIds: [],
        downtimeMonitorStatusIds: [OFFLINE],
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      });

    expect(totals).toEqual({ coveredSeconds: 0, downtimeSeconds: 0 });
    expect(stub.calls).toHaveLength(0);
    expect(stub.getRepositoryCalls()).toBe(0);
  });
});

/*
 * THE TIME BEFORE A MONITOR'S FIRST CHECK (issue #8960). Every monitor is
 * created in the operational status, which no check stands behind until
 * something has measured it (Monitor.firstMeasuredAt), so the statements
 * that measure a monitor's time leave that time out - all of it while
 * nothing has checked the monitor - after the LEAD, as the time with
 * monitoring off is. The SQL was run against Postgres
 * (MonitorStatusTimelineMonitoringOffPostgres.test.ts); these pin the parts
 * that must not drift apart between the four statements.
 */
describe("the time before a monitor's first check, in every statement (issue #8960)", () => {
  async function groupSql(): Promise<string> {
    const stub: StubbedService = stubService();

    await stub.service.getMonitorGroupDailyUptimeAggregate({
      monitorGroups: [
        {
          monitorGroupId: new ObjectID(MONITOR_B),
          monitorIds: [new ObjectID(MONITOR_A)],
        },
      ],
      rankedMonitorStatusIds: [OFFLINE],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    });

    return flatten(stub.calls[0]!.sql);
  }

  async function rollingSql(): Promise<string> {
    const stub: StubbedService = stubService();

    await stub.service.getRollingUptimeTotals({
      monitorId: new ObjectID(MONITOR_A),
      windows: [
        {
          key: MonitorUptimeWindowKey.Last24Hours,
          startDate: new Date(WINDOW_END.getTime() - 86400 * 1000),
        },
      ],
      endDate: WINDOW_END,
    });

    return flatten(stub.calls[0]!.sql);
  }

  test("a monitor's days, a group's days and the merged downtime cut every period the same way", async () => {
    const aggregate: ReturnType<typeof rowRules> = rowRules(
      await aggregateSql(),
    );
    const merged: ReturnType<typeof rowRules> = rowRules(await mergedSql());
    const groupRules: RegExpMatchArray | null = (await groupSql()).match(
      /GREATEST\( t\."startsAt", p\.win_start, (CASE .*? END) \) AS s, (.*?) AS e FROM "MonitorStatusTimeline" t CROSS JOIN params p (LEFT JOIN measured mf ON mf\.monitor_id = t\."monitorId") (WHERE .*?) \), \w+ AS \(/,
    );

    expect(groupRules).not.toBeNull();
    expect(merged.start).toBe(aggregate.start);
    expect(groupRules![1]).toBe(aggregate.start);
    expect(groupRules![3]).toBe(aggregate.measuredJoin);
  });

  test("when a monitor's time starts to count: its first check, never while nothing has checked it, always for a manual monitor", async () => {
    for (const sql of [await aggregateSql(), await mergedSql()]) {
      expect(sql).toContain(
        `measured AS ( SELECT m."_id" AS monitor_id, CASE WHEN m."monitorType" IS NULL OR m."monitorType" = 'Manual' THEN '-infinity'::timestamptz ELSE COALESCE(m."firstMeasuredAt", 'infinity'::timestamptz) END AS measured_from FROM "Monitor" m WHERE m."_id" = ANY($1::uuid[]) )`,
      );
    }

    // A group reads its members', which are $2.
    expect(await groupSql()).toContain(
      `FROM "Monitor" m WHERE m."_id" = ANY($2::uuid[]) )`,
    );
    // The rolling windows read the one monitor's.
    expect(await rollingSql()).toContain(
      `FROM "Monitor" m WHERE m."_id" = ANY(ARRAY[$1::uuid]) )`,
    );
  });

  test("only a period of a status a monitor can start in, before its first check, is cut, and the cut is never NULL", async () => {
    const start: string = rowRules(await aggregateSql()).start;

    // Time with monitoring off, and a period once it has been checked: no cut.
    expect(start).toContain(
      `WHEN t."isMonitoringOff" IS TRUE OR t."startsAt" >= COALESCE(mf.measured_from, '-infinity'::timestamptz) THEN '-infinity'::timestamptz`,
    );
    // Operational and not offline as well: the status every monitor starts in.
    expect(start).toContain(
      `WHEN EXISTS ( SELECT 1 FROM "MonitorStatus" ms WHERE ms."_id" = t."monitorStatusId" AND ms."isOperationalState" IS TRUE AND ms."isOfflineState" IS NOT TRUE ) THEN mf.measured_from`,
    );
    // Anything else, a status something recorded: no cut. GREATEST ignores a NULL.
    expect(start).toMatch(/ELSE '-infinity'::timestamptz END$/);
    expect(start).not.toMatch(/THEN NULL|ELSE NULL/);
  });

  test("the cut is made after the LEAD has seen every row: no row is filtered before it", async () => {
    for (const sql of [await aggregateSql(), await mergedSql()]) {
      const rules: ReturnType<typeof rowRules> = rowRules(sql);

      // The WHERE clause is the overlap predicate alone, as before.
      expect(rules.where).toBe(
        'WHERE t."monitorId" = ANY($1::uuid[]) AND t."deletedAt" IS NULL AND t."startsAt" <= p.eff_end AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)',
      );
      expect(rules.where).not.toContain("measured");
      // and the LEAD reads startsAt, never the cut start.
      expect(rules.end).toContain('LEAD(t."startsAt")');
    }
  });

  test("a monitor's rolling windows cut by the same rule, on each window's rows", async () => {
    const sql: string = await rollingSql();

    expect(sql).toContain(
      `GREATEST( r.starts_at, w.win_start, CASE WHEN r.is_off OR r.starts_at >= COALESCE(mf.measured_from, '-infinity'::timestamptz) THEN '-infinity'::timestamptz WHEN EXISTS ( SELECT 1 FROM "MonitorStatus" ms WHERE ms."_id" = r.status_id AND ms."isOperationalState" IS TRUE AND ms."isOfflineState" IS NOT TRUE ) THEN mf.measured_from ELSE '-infinity'::timestamptz END ) AS s`,
    );
    // A monitor that is not found counts as it always did: a LEFT JOIN, not a CROSS JOIN.
    expect(sql).toContain("LEFT JOIN measured mf ON true");
    // The rows are read, and each window's LEAD taken, before anything is cut.
    expect(sql).toContain(
      "WHERE r.ends_at >= w.win_start OR r.ends_at IS NULL ), agg AS (",
    );
    expect(sql).toContain(
      "LEAD(r.starts_at) OVER ( PARTITION BY w.window_no ORDER BY r.starts_at, r.ends_at NULLS LAST )",
    );
  });
});

describe("MonitorStatusTimelineService.toMergedDowntimeTotals", () => {
  test("coerces numbers the driver hands back as strings", () => {
    expect(
      MonitorStatusTimelineServiceType.toMergedDowntimeTotals([
        { coveredSeconds: "86400.25", downtimeSeconds: "3600" },
      ]),
    ).toEqual({ coveredSeconds: 86400.25, downtimeSeconds: 3600 });
  });

  test("reads anything that is not a positive number as zero", () => {
    const rows: Array<MergedDowntimeRow> = [
      { coveredSeconds: null, downtimeSeconds: "not a number" },
    ];

    expect(
      MonitorStatusTimelineServiceType.toMergedDowntimeTotals(rows),
    ).toEqual({ coveredSeconds: 0, downtimeSeconds: 0 });

    expect(
      MonitorStatusTimelineServiceType.toMergedDowntimeTotals([
        { coveredSeconds: -5, downtimeSeconds: -1 },
      ]),
    ).toEqual({ coveredSeconds: 0, downtimeSeconds: 0 });
  });

  test("reads a missing row as nothing recorded", () => {
    expect(MonitorStatusTimelineServiceType.toMergedDowntimeTotals([])).toEqual(
      {
        coveredSeconds: 0,
        downtimeSeconds: 0,
      },
    );
  });
});
