import {
  MergedDowntimeRow,
  MergedDowntimeTotals,
  Service as MonitorStatusTimelineServiceType,
} from "../../../Server/Services/MonitorStatusTimelineService";
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
 * The parts of a src CTE that decide which rows count and where each ends:
 * the window, the end expression, and the WHERE clause.
 */
function rowRules(sql: string): {
  window: string;
  end: string;
  where: string;
} {
  const window: RegExpMatchArray | null = sql.match(
    /WITH params AS \( SELECT (\$2::timestamptz AS win_start, LEAST\(\$3::timestamptz, now\(\)\) AS eff_end)/,
  );
  const src: RegExpMatchArray | null = sql.match(
    /GREATEST\(t\."startsAt", p\.win_start\) AS s, (.*?) AS e FROM "MonitorStatusTimeline" t CROSS JOIN params p (WHERE .*?) \), \w+ AS \(/,
  );

  expect(window).not.toBeNull();
  expect(src).not.toBeNull();

  return {
    window: window![1]!,
    end: src![1]!,
    where: src![2]!,
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
