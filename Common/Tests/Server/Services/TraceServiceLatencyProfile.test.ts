import TraceAggregationService, {
  ServiceLatencyProfile,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * getServiceLatencyProfile is the ONLY query the unattended insight scanner
 * runs against the full Span table every 15 minutes for every opted-in
 * project. It is affordable exactly and only while ClickHouse can serve it
 * from the proj_agg_by_service aggregate projection
 * (projectId, primaryEntityId, toStartOfMinute(startTime) -> count() /
 * avg(durationUnixNano) / quantile(0.99)(durationUnixNano)).
 *
 * The projection match is a BYTE-MATCH on the aggregate expressions and the
 * key expression: fold a `/ 1000000` into the quantile, compare raw
 * startTime instead of toStartOfMinute(startTime), add the retentionDate
 * filter or group by anything outside the projection's keys, and ClickHouse
 * silently reverts to a 25-hour raw-span scan — which then trips the
 * execution cap and returns partial aggregates. Nothing in the query plan is
 * observable from TypeScript, so these SQL-shape assertions are the guard.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-07-14T11:00:00.000Z");
const endTime: Date = new Date("2026-07-14T12:00:00.000Z");

const stubQuery: (response: {
  rows?: Array<JSONObject>;
  elapsedSeconds?: number;
  throwOnParse?: boolean;
}) => jest.SpyInstance = (response: {
  rows?: Array<JSONObject>;
  elapsedSeconds?: number;
  throwOnParse?: boolean;
}): jest.SpyInstance => {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      if (response.throwOnParse) {
        return Promise.reject(new Error("Unexpected end of JSON input"));
      }
      return Promise.resolve({
        data: response.rows || [],
        statistics: {
          elapsed: response.elapsedSeconds ?? 0.004,
          rows_read: 10,
          bytes_read: 100,
        },
      });
    },
  } as unknown as Results;

  return jest
    .spyOn(SpanService, "executeQuery")
    .mockResolvedValue(fakeResult as never);
};

const capturedQuery: (spy: jest.SpyInstance) => string = (
  spy: jest.SpyInstance,
): string => {
  const statement: Statement = spy.mock.calls[0]![0] as Statement;
  // The query getter dedents — normalize whitespace before matching SQL.
  return statement.query.replace(/\s+/g, " ");
};

describe("TraceAggregationService.getServiceLatencyProfile (projection-served SQL shape)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("selects ONLY the aggregates proj_agg_by_service stores, byte-for-byte", async () => {
    const spy: jest.SpyInstance = stubQuery({ rows: [] });

    await TraceAggregationService.getServiceLatencyProfile({
      projectId,
      startTime,
      endTime,
      limit: 25,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain("count() AS cnt");
    expect(query).toContain("quantile(0.99)(durationUnixNano) AS p99_ns");

    /*
     * The ns->ms division MUST stay in TypeScript: `quantile(0.99)(x) /
     * 1000000` is not the stored expression, so it disqualifies the
     * projection.
     */
    expect(query).not.toContain("1000000");

    // Every other stat in getAnalyticsTable's set has no stored state.
    expect(query).not.toContain("countIf");
    expect(query).not.toContain("quantile(0.95)");
    expect(query).not.toContain("quantile(0.9)(");
    expect(query).not.toContain("quantile(0.5)");
    expect(query).not.toContain("min(durationUnixNano)");
    expect(query).not.toContain("max(durationUnixNano)");
  });

  test("filters on the projection key expression, never raw startTime, and never retentionDate", async () => {
    const spy: jest.SpyInstance = stubQuery({ rows: [] });

    await TraceAggregationService.getServiceLatencyProfile({
      projectId,
      startTime,
      endTime,
      limit: 25,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain("toStartOfMinute(startTime) >= toStartOfMinute(");
    // Half-open: the boundary minute must not be counted in both windows.
    expect(query).toContain("toStartOfMinute(startTime) < toStartOfMinute(");

    // A bare `startTime <op>` comparison would reject the projection.
    expect(query).not.toMatch(/startTime\s*(>=|<=|>|<)/);

    // retentionDate is not stored by the aggregate projection.
    expect(query).not.toContain("retentionDate");
  });

  test("groups by a subset of the projection keys and caps the row count", async () => {
    const spy: jest.SpyInstance = stubQuery({ rows: [] });

    await TraceAggregationService.getServiceLatencyProfile({
      projectId,
      startTime,
      endTime,
      limit: 25,
    });

    const query: string = capturedQuery(spy);

    /*
     * primaryEntityId only — dropping the `minute` key merges the stored
     * per-minute aggregate states into a whole-window value. Any dimension
     * outside (projectId, primaryEntityId, minute) forces a full scan.
     */
    expect(query).toContain("GROUP BY primaryEntityId ORDER BY cnt DESC LIMIT");
    expect(query).not.toContain("statusCode");
    expect(query).not.toContain("attributes[");

    const statement: Statement = spy.mock.calls[0]![0] as Statement;
    expect(Object.values(statement.query_params)).toContain(25);
  });

  test("caps execution at 45s and explicitly enables projections", async () => {
    const spy: jest.SpyInstance = stubQuery({ rows: [] });

    await TraceAggregationService.getServiceLatencyProfile({
      projectId,
      startTime,
      endTime,
      limit: 25,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain("max_execution_time = 45");
    expect(query).toContain("timeout_overflow_mode = 'break'");
    expect(query).toContain("optimize_use_projections = 1");
  });

  test("converts ns to ms in TS and drops rows without an entity id", async () => {
    stubQuery({
      rows: [
        { primaryEntityId: "svc-1", cnt: "500", p99_ns: "2300000000" },
        { primaryEntityId: "", cnt: "9", p99_ns: "1000000" },
      ],
    });

    const result: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId,
        startTime,
        endTime,
        limit: 25,
      });

    expect(result.rows).toEqual([
      { primaryEntityId: "svc-1", count: 500, p99DurationMs: 2300 },
    ]);
    expect(result.isPartial).toBe(false);
  });
});

/*
 * With timeout_overflow_mode='break' a cut-off query returns a well-formed
 * body holding PARTIAL aggregates — no exception, no marker. The insight
 * scanner compares two windows, so partial data is not "less data", it is a
 * wrong p99. `statistics.elapsed` at the cap is the only available signal
 * that this happened, and the caller is contractually required to discard
 * the tick when it is set.
 */
describe("TraceAggregationService.getServiceLatencyProfile (partial-result detection)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a query that burned its whole execution budget is reported as partial", async () => {
    stubQuery({
      rows: [{ primaryEntityId: "svc-1", cnt: "500", p99_ns: "2300000000" }],
      elapsedSeconds: 45,
    });

    const result: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId,
        startTime,
        endTime,
        limit: 25,
      });

    expect(result.isPartial).toBe(true);
  });

  test("break fires slightly before the cap — 90% of the budget already counts as partial", async () => {
    stubQuery({
      rows: [{ primaryEntityId: "svc-1", cnt: "500", p99_ns: "2300000000" }],
      elapsedSeconds: 40.5,
    });

    const result: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId,
        startTime,
        endTime,
        limit: 25,
      });

    expect(result.isPartial).toBe(true);
  });

  test("a fast projection-served query is complete", async () => {
    stubQuery({
      rows: [{ primaryEntityId: "svc-1", cnt: "500", p99_ns: "2300000000" }],
      elapsedSeconds: 0.006,
    });

    const result: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId,
        startTime,
        endTime,
        limit: 25,
      });

    expect(result.isPartial).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  /*
   * 'break' can also truncate the JSON body outright. An unparseable body is
   * partial — NOT an empty profile, which the caller would read as "this
   * project has no traffic".
   */
  test("an unparseable (truncated) response is partial, not empty-and-trusted", async () => {
    stubQuery({ throwOnParse: true });

    const result: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId,
        startTime,
        endTime,
        limit: 25,
      });

    expect(result.rows).toEqual([]);
    expect(result.isPartial).toBe(true);
  });
});
