import TraceAggregationService, {
  ServiceSpanHealthRow,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * getServiceSpanHealth: every service's spans, failed spans and root spans
 * over an hour, read once an hour for every project with Traces' AI section
 * on (Utils/Traces/TraceInsight's first stage). It is affordable only while
 * ClickHouse serves it from the proj_hist_by_minute aggregate projection
 * (projectId, minute, primaryEntityId, statusCode, isRootSpan -> count()),
 * and that match is silent: a raw startTime comparison, the retention
 * filter, another aggregate or a group outside the projection's keys turns
 * it into an hour-long raw scan without a trace in TypeScript. These SQL
 * shape assertions are the guard, as for getServiceLatencyProfile.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-10-24T08:00:00.000Z");
const endTime: Date = new Date("2026-10-24T09:00:00.000Z");

// A bare comparison of startTime would reject the projection.
const RAW_START_TIME_COMPARISON: RegExp = /startTime\s*(>=|<=|>|<)/;
const WHITESPACE: RegExp = /\s+/g;

const stubQuery: (rows: Array<JSONObject>) => jest.SpyInstance = (
  rows: Array<JSONObject>,
): jest.SpyInstance => {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
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
  return statement.query.replace(WHITESPACE, " ");
};

describe("TraceAggregationService.getServiceSpanHealth (projection-served SQL shape)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts only what proj_hist_by_minute stores, grouped by its own keys", async () => {
    const spy: jest.SpyInstance = stubQuery([]);

    await TraceAggregationService.getServiceSpanHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain(
      "SELECT primaryEntityId, statusCode, isRootSpan, count() AS cnt",
    );
    expect(query).toContain(
      "GROUP BY primaryEntityId, statusCode, isRootSpan",
    );
    expect(query).not.toContain("countIf");
    expect(query).not.toContain("quantile");
    expect(query).not.toContain("durationUnixNano");
  });

  test("filters on the projection's minute, half-open, and never on retentionDate", async () => {
    const spy: jest.SpyInstance = stubQuery([]);

    await TraceAggregationService.getServiceSpanHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain("toStartOfMinute(startTime) >= toStartOfMinute(");
    expect(query).toContain("toStartOfMinute(startTime) < toStartOfMinute(");
    expect(query).not.toMatch(RAW_START_TIME_COMPARISON);
    expect(query).not.toContain("retentionDate");
    expect(query).toContain("optimize_use_projections = 1");
  });

  test("stops with an error at its time limit, rather than answer with part of the counts", async () => {
    const spy: jest.SpyInstance = stubQuery([]);

    await TraceAggregationService.getServiceSpanHealth({
      projectId,
      startTime,
      endTime,
      limit: 200,
    });

    const query: string = capturedQuery(spy);

    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("'break'");
  });

  test("sums each service's rows: every span, the failed ones, the root ones", async () => {
    const service: string = "5229eeee-0000-4000-8000-000000000001";

    stubQuery([
      { primaryEntityId: service, statusCode: 0, isRootSpan: true, cnt: "100" },
      { primaryEntityId: service, statusCode: 0, isRootSpan: false, cnt: 800 },
      { primaryEntityId: service, statusCode: 2, isRootSpan: 1, cnt: 30 },
      { primaryEntityId: service, statusCode: 2, isRootSpan: "0", cnt: 20 },
      { primaryEntityId: service, statusCode: 1, isRootSpan: "true", cnt: 50 },
    ]);

    const rows: Array<ServiceSpanHealthRow> =
      await TraceAggregationService.getServiceSpanHealth({
        projectId,
        startTime,
        endTime,
        limit: 200,
      });

    expect(rows).toEqual([
      {
        primaryEntityId: service,
        spanCount: 1000,
        failedSpanCount: 50,
        rootSpanCount: 180,
      },
    ]);
  });
});

describe("TraceAggregationService.toServiceSpanHealth", () => {
  test("busiest first, ties by id, cut to the limit, ids lower-cased", () => {
    const a: string = "5229eeee-0000-4000-8000-00000000000a";
    const b: string = "5229eeee-0000-4000-8000-00000000000b";
    const c: string = "5229eeee-0000-4000-8000-00000000000c";

    expect(
      TraceAggregationService.toServiceSpanHealth(
        [
          { primaryEntityId: c.toUpperCase(), statusCode: 0, cnt: 10 },
          { primaryEntityId: b, statusCode: 0, cnt: 500 },
          { primaryEntityId: a, statusCode: 0, cnt: 500 },
        ],
        2,
      ).map((row: ServiceSpanHealthRow) => row.primaryEntityId),
    ).toEqual([a, b]);
  });

  test("rows without a service, or with nothing counted, are left out", () => {
    expect(
      TraceAggregationService.toServiceSpanHealth(
        [
          { primaryEntityId: "", statusCode: 0, cnt: 10 },
          { statusCode: 0, cnt: 10 },
          { primaryEntityId: "x", statusCode: 0, cnt: 0 },
          { primaryEntityId: "y", statusCode: 0, cnt: "not a number" },
        ],
        10,
      ),
    ).toEqual([]);
  });

  test("a limit of nothing is nothing", () => {
    expect(
      TraceAggregationService.toServiceSpanHealth(
        [{ primaryEntityId: "x", statusCode: 0, cnt: 10 }],
        0,
      ),
    ).toEqual([]);
  });
});
