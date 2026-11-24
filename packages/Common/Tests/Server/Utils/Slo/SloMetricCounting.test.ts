import SloMetricCounting, {
  SLO_METRIC_COUNT_TIME_LIMIT_SECONDS,
  SLO_METRIC_LOOKBACK_MINUTES,
} from "../../../../Server/Utils/Slo/SloMetricCounting";
import SloRequestCounting, {
  SloRequestCountingConfig,
} from "../../../../Server/Utils/Slo/SloRequestCounting";
import MetricService from "../../../../Server/Services/MetricService";
import SpanService from "../../../../Server/Services/SpanService";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import {
  SloMetricKind,
  SloMetricQueryConfig,
} from "../../../../Utils/Slo/SloMetricSli";
import {
  SloRequestCountingRange,
  SloRequestCounts,
} from "../../../../Utils/Slo/SloRequestSli";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * SloMetricCounting: a Metric SLO's good and total events from its
 * services' metric points (#8445), in the request SLOs' 5-minute steps.
 *
 * The SQL is pinned by its shape here. Its answers were checked against
 * ClickHouse 26.7 with points whose counts are known - a cumulative counter
 * that restarts, a series that starts inside the range, delta series,
 * another service's points, a gauge of the same name, a cumulative
 * histogram that restarts and a delta one - and the answers matched to the
 * event: a counter that read every point's value, or a histogram that
 * counted the last bucket as good, would still run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_A: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SERVICE_B: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const COUNTER: SloMetricQueryConfig = {
  metricName: "http_requests_total",
  kind: SloMetricKind.Counter,
  goodFilter: "@http.response.status_code:<500",
};

const HISTOGRAM: SloMetricQueryConfig = {
  metricName: "http.server.request.duration",
  kind: SloMetricKind.Histogram,
  goodAtOrUnder: 0.3,
};

const STEP: number = 5 * 60 * 1000;
const FROM: number = Date.UTC(2026, 10, 15, 10, 0, 0);
const RANGE: SloRequestCountingRange = {
  from: new Date(FROM),
  to: new Date(FROM + 3 * STEP),
};

const WHITESPACE: RegExp = /\s+/g;

function oneLine(statement: Statement): string {
  return statement.query.replace(WHITESPACE, " ");
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function resultOf(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

function countStatement(config: SloMetricQueryConfig): Statement {
  return SloMetricCounting.buildCountStatement({
    projectId: PROJECT_ID,
    serviceIds: [SERVICE_A, SERVICE_B],
    config: config,
    range: RANGE,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SloMetricCounting.buildCountStatement", () => {
  test("reads only the SLO's services' points of the metric, of its own type, still kept", () => {
    const statement: Statement = countStatement(COUNTER);
    const sql: string = oneLine(statement);
    const params: Array<unknown> = paramValues(statement);

    expect(sql).toContain("FROM {");
    expect(params).toContain("MetricItemV3");
    expect(sql).toMatch(
      /WHERE projectId = \{p\d+:String\} AND name = \{p\d+:String\} AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(params).toContain(PROJECT_ID.toString());
    expect(params).toContain("http_requests_total");
    expect(params).toContainEqual([SERVICE_A.toString(), SERVICE_B.toString()]);
    expect(sql).toContain("AND retentionDate >= now()");
    expect(sql).toMatch(/AND metricPointType = \{p\d+:String\}/);
    expect(params).toContain("Sum");
    expect(paramValues(countStatement(HISTOGRAM))).toContain("Histogram");
  });

  test(`reads ${SLO_METRIC_LOOKBACK_MINUTES} minutes before the range for baselines, and counts only the range`, () => {
    const statement: Statement = countStatement(COUNTER);
    const params: Array<unknown> = paramValues(statement);

    expect(params).toContain("2026-11-15 09:30:00.000000000");
    expect(oneLine(statement)).toMatch(
      /\) WHERE increase\.1 >= \{p\d+:DateTime64\(9\)\} AND increase\.1 < \{p\d+:DateTime64\(9\)\} GROUP BY stepStart/,
    );
    expect(params).toContain("2026-11-15 10:00:00.000000000");
    expect(params).toContain("2026-11-15 10:15:00.000000000");
  });

  test("groups points into series: a service, an attribute set, a temporality and a start time", () => {
    expect(oneLine(countStatement(COUNTER))).toContain(
      "GROUP BY primaryEntityId, aggregationTemporality, cityHash64(mapKeys(attributes), mapValues(attributes)), ifNull(startTimeUnixNano, 0))",
    );
  });

  test("counts a cumulative series' growth, a restart from zero, and a delta series' points", () => {
    const sql: string = oneLine(countStatement(COUNTER));

    expect(sql).toContain(
      "ifNull(aggregationTemporality, '') = 'Cumulative' AS isCumulative",
    );
    expect(sql).toContain(
      "if(current.2 >= previous.2, (current.1, current.2 - previous.2, greatest(current.3 - previous.3, 0)), (current.1, greatest(current.2, 0), greatest(current.3, 0)))",
    );
    // A series that started in the read range counts its first point from zero.
    expect(sql).toContain("arraySlice([seriesPoints[1]], 1, startedInRead)");
    expect(sql).toMatch(
      /toUInt8\(ifNull\(min\(startTime\) >= \{p\d+:DateTime64\(9\)\}, 0\)\) AS startedInRead/,
    );
    // A delta series' points are its growth.
    expect(sql).toContain(
      "arrayPopBack(seriesPoints))), seriesPoints)) AS increase",
    );
  });

  test("a counter's good events are its value on the series that match the good condition", () => {
    const statement: Statement = countStatement(COUNTER);
    const sql: string = oneLine(statement);

    expect(sql).toContain(
      "groupArray((time, toFloat64(ifNull(value, 0)), if((1 = 1 AND",
    );
    expect(sql).toMatch(
      /toFloat64OrNull\(\{p\d+:Identifier\}\[\{p\d+:String\}\]\) < \{p\d+:Double\}\), toFloat64\(ifNull\(value, 0\)\), 0\)/,
    );
    expect(paramValues(statement)).toContain("http.response.status_code");
    expect(paramValues(statement)).toContain(500);
  });

  test("a histogram's good events are its buckets at or under the value, never the last bucket", () => {
    const statement: Statement = countStatement(HISTOGRAM);
    const sql: string = oneLine(statement);

    expect(sql).toContain("toFloat64(ifNull(count, 0))");
    expect(sql).toMatch(
      /if\(bucketIndex <= length\(explicitBounds\) AND toFloat64\(explicitBounds\[bucketIndex\]\) <= \{p\d+:Double\}, toFloat64\(bucketCount\), 0\), bucketCounts, arrayEnumerate\(bucketCounts\)\)/,
    );

    const bound: number = paramValues(statement).find(
      (value: unknown): boolean => {
        return typeof value === "number" && value > 0.29 && value < 0.31;
      },
    ) as number;

    // 0.3 read back as 0.30000000000000004 is still 0.3; 0.31 is not.
    expect(bound).toBeGreaterThanOrEqual(0.3);
    expect(bound).toBeLessThan(0.3000001);
  });

  test("a filter narrows the series, each term a typed parameter", () => {
    const statement: Statement = countStatement({
      ...COUNTER,
      filter: "@http.route:/checkout* -@http.route:/checkout/health",
    });

    expect(paramValues(statement)).toContain("http.route");
    expect(oneLine(statement)).toMatch(/ILIKE|LIKE|!=/);
    expect(oneLine(statement)).not.toContain("/checkout");
  });

  test(`is bounded: ${SLO_METRIC_COUNT_TIME_LIMIT_SECONDS} seconds, then it throws`, () => {
    const sql: string = oneLine(countStatement(HISTOGRAM));

    expect(sql).toContain(
      `SETTINGS max_execution_time = ${SLO_METRIC_COUNT_TIME_LIMIT_SECONDS}, timeout_overflow_mode = 'throw'`,
    );
  });

  test("refuses a configuration it cannot count with, saying why", () => {
    expect(() => {
      return countStatement({ metricName: "m", kind: SloMetricKind.Counter });
    }).toThrow(BadDataException);
    expect(() => {
      return countStatement({ ...HISTOGRAM, goodAtOrUnder: 0 });
    }).toThrow(
      "Enter the value a good observation stays at or under: a number greater than 0, in the metric's own unit, such as 0.3.",
    );
  });
});

describe("SloMetricCounting.buildRecentCountStatement", () => {
  test("sums the range in one row, with a release's version when it is given", () => {
    const statement: Statement = SloMetricCounting.buildRecentCountStatement({
      projectId: PROJECT_ID,
      serviceIds: [SERVICE_A],
      config: COUNTER,
      range: RANGE,
      serviceVersion: "2.4.1",
    });
    const sql: string = oneLine(statement);

    expect(sql).toMatch(
      /^SELECT sum\(greatest\(increase\.2, 0\)\) AS totalCount, sum\(greatest\(increase\.3, 0\)\) AS goodCount FROM \(/,
    );
    expect(sql).not.toContain("GROUP BY stepStart");
    expect(sql).toMatch(/AND attributes\[\{p\d+:String\}\] = \{p\d+:String\}/);
    expect(paramValues(statement)).toContain("resource.service.version");
    expect(paramValues(statement)).toContain("2.4.1");
  });
});

describe("SloMetricCounting.countRange", () => {
  test("fills every step of the range, and reads each row's counts", async () => {
    const query: SpyInstance<typeof MetricService.executeQuery> = jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue(
        resultOf([
          { stepStart: FROM / 1000, totalCount: "40", goodCount: "38" },
          {
            stepStart: (FROM + STEP) / 1000,
            totalCount: 132.5,
            goodCount: 129,
          },
          // Outside the range: never a step of its own.
          { stepStart: (FROM - STEP) / 1000, totalCount: 7, goodCount: 7 },
        ]),
      );

    const counts: Map<number, SloRequestCounts> =
      await SloMetricCounting.countRange({
        projectId: PROJECT_ID,
        serviceIds: [SERVICE_A],
        config: COUNTER,
        range: RANGE,
      });

    expect(query).toHaveBeenCalledTimes(1);
    expect([...counts.entries()]).toEqual([
      [FROM, { goodCount: 38, totalCount: 40 }],
      [FROM + STEP, { goodCount: 129, totalCount: 132.5 }],
      [FROM + 2 * STEP, { goodCount: 0, totalCount: 0 }],
    ]);
  });

  test("never reads more good events than events, or fewer than none", () => {
    expect(
      SloMetricCounting.toCounts({ totalCount: 10, goodCount: 12 }),
    ).toEqual({ goodCount: 10, totalCount: 10 });
    expect(
      SloMetricCounting.toCounts({ totalCount: -3, goodCount: "x" }),
    ).toEqual({ goodCount: 0, totalCount: 0 });
  });

  test("an SLO with no services reads nothing: every step is empty", async () => {
    const query: SpyInstance<typeof MetricService.executeQuery> = jest.spyOn(
      MetricService,
      "executeQuery",
    );

    const counts: Map<number, SloRequestCounts> =
      await SloMetricCounting.countRange({
        projectId: PROJECT_ID,
        serviceIds: [],
        config: COUNTER,
        range: RANGE,
      });

    expect(query).not.toHaveBeenCalled();
    expect(counts.size).toBe(3);
  });
});

/*
 * #10027: an SLO that counted nothing says why when its metric's points
 * say so - the newest point's kind, of its services, whatever its kind.
 */
describe("SloMetricCounting.getNewestPointType", () => {
  const POINT_TYPE_RANGE: { from: Date; to: Date } = {
    from: new Date(FROM - 30 * 24 * 60 * 60 * 1000),
    to: new Date(FROM),
  };

  test("reads the newest point of the SLO's services' metric, of any kind", () => {
    const statement: Statement =
      SloMetricCounting.buildNewestPointTypeStatement({
        projectId: PROJECT_ID,
        serviceIds: [SERVICE_A, SERVICE_B],
        metricName: "azure_requests_total",
        ...POINT_TYPE_RANGE,
      });
    const sql: string = oneLine(statement);
    const params: Array<unknown> = paramValues(statement);

    expect(sql).toMatch(/^SELECT metricPointType FROM \{/);
    expect(params).toContain("MetricItemV3");
    expect(sql).toMatch(
      /WHERE projectId = \{p\d+:String\} AND name = \{p\d+:String\} AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(params).toContain(PROJECT_ID.toString());
    expect(params).toContain("azure_requests_total");
    expect(params).toContainEqual([SERVICE_A.toString(), SERVICE_B.toString()]);
    expect(sql).toContain("AND retentionDate >= now()");
    expect(sql).toMatch(/ORDER BY time DESC LIMIT 1$/);
    // Every kind: not only the one the SLO counts.
    expect(sql).not.toContain("metricPointType =");
    expect(params).toContain("2026-10-16 10:00:00.000000000");
    expect(params).toContain("2026-11-15 10:00:00.000000000");
  });

  test("answers the newest row's kind, or null with no row, no service or no name", async () => {
    const query: SpyInstance<typeof MetricService.executeQuery> = jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue(resultOf([{ metricPointType: "Gauge" }]));

    expect(
      await SloMetricCounting.getNewestPointType({
        projectId: PROJECT_ID,
        serviceIds: [SERVICE_A],
        metricName: "azure_requests_total",
        ...POINT_TYPE_RANGE,
      }),
    ).toBe("Gauge");
    expect(query).toHaveBeenCalledTimes(1);

    query.mockResolvedValue(resultOf([]));

    expect(
      await SloMetricCounting.getNewestPointType({
        projectId: PROJECT_ID,
        serviceIds: [SERVICE_A],
        metricName: "azure_requests_total",
        ...POINT_TYPE_RANGE,
      }),
    ).toBeNull();

    query.mockClear();

    expect(
      await SloMetricCounting.getNewestPointType({
        projectId: PROJECT_ID,
        serviceIds: [],
        metricName: "azure_requests_total",
        ...POINT_TYPE_RANGE,
      }),
    ).toBeNull();
    expect(
      await SloMetricCounting.getNewestPointType({
        projectId: PROJECT_ID,
        serviceIds: [SERVICE_A],
        metricName: "  ",
        ...POINT_TYPE_RANGE,
      }),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("SloRequestCounting, for a Metric SLO", () => {
  const METRIC: SloRequestCountingConfig = {
    sliType: SliType.Metric,
    serviceIds: [SERVICE_A],
    metricQueryConfig: COUNTER as unknown as JSONObject,
  };

  test("counts its range from the metric, never the spans", async () => {
    const metricQuery: SpyInstance<typeof MetricService.executeQuery> = jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue(resultOf([]));
    const spanQuery: SpyInstance<typeof SpanService.executeQuery> = jest.spyOn(
      SpanService,
      "executeQuery",
    );

    await SloRequestCounting.countRange({
      projectId: PROJECT_ID,
      config: METRIC,
      range: RANGE,
    });

    expect(metricQuery).toHaveBeenCalledTimes(1);
    expect(spanQuery).not.toHaveBeenCalled();
  });

  test("counts a release check's recent events from the metric too", async () => {
    const metricQuery: SpyInstance<typeof MetricService.executeQuery> = jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue(resultOf([{ totalCount: 100, goodCount: 99 }]));

    await expect(
      SloRequestCounting.countRecentRequests({
        projectId: PROJECT_ID,
        config: METRIC,
        range: RANGE,
        serviceVersion: "2.4.1",
      }),
    ).resolves.toEqual({ goodCount: 99, totalCount: 100 });
    expect(paramValues(metricQuery.mock.calls[0]![0] as Statement)).toContain(
      "2.4.1",
    );
  });

  test("refuses a stored configuration it cannot read, rather than count nothing", async () => {
    await expect(
      SloRequestCounting.countRange({
        projectId: PROJECT_ID,
        config: { ...METRIC, metricQueryConfig: { kind: "Counter" } },
        range: RANGE,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("its fingerprint changes with what the metric counts, and only that", () => {
    const fingerprint: string = SloRequestCounting.getFingerprint(METRIC);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      SloRequestCounting.getFingerprint({
        ...METRIC,
        metricQueryConfig: { ...COUNTER, metricName: "  http_requests_total " },
      }),
    ).toBe(fingerprint);

    for (const changed of [
      { ...COUNTER, metricName: "grpc_requests_total" },
      { ...COUNTER, goodFilter: "@http.response.status_code:<400" },
      { ...COUNTER, filter: "@http.route:/checkout*" },
      HISTOGRAM,
      { ...HISTOGRAM, goodAtOrUnder: 0.5 },
    ]) {
      expect(
        SloRequestCounting.getFingerprint({
          ...METRIC,
          metricQueryConfig: changed as unknown as JSONObject,
        }),
      ).not.toBe(fingerprint);
    }
  });

  test("a request SLO's fingerprint does not read a metric configuration it does not use", () => {
    const success: SloRequestCountingConfig = {
      sliType: SliType.RequestSuccess,
      serviceIds: [SERVICE_A],
    };

    expect(
      SloRequestCounting.getFingerprint({
        ...success,
        metricQueryConfig: COUNTER as unknown as JSONObject,
      }),
    ).toBe(SloRequestCounting.getFingerprint(success));
  });
});
