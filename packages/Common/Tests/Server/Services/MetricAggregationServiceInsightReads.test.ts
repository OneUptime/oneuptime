import MetricAggregationService, {
  MetricAttributeCardinalityRow,
  MetricSeriesKey,
  MetricShapeRow,
} from "../../../Server/Services/MetricAggregationService";
import MetricService from "../../../Server/Services/MetricService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  METRIC_NAME_ID_PATTERN,
  METRIC_NAME_ID_PLACEHOLDER,
  MetricNamePatternReading,
  MetricVolumeReading,
  OTEL_METRIC_OVERFLOW_ATTRIBUTE,
} from "../../../Utils/Metrics/MetricInsight";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The Metrics AI lane's reads (MetricAggregationService): every metric of
 * the hour from the hourly rollup (MetricBaselineHourly) - its data points,
 * and its names with their ids collapsed - then a few metrics read closely
 * from the metric table by its own sort key: their data points by kind, and
 * how many values each attribute their code sets took. Every value is a
 * query parameter, never written into the SQL; each read stops with an
 * error at its time limit rather than answer with part of its rows; and
 * the close reads skip rows past their retention. The reads themselves run
 * against a real ClickHouse in App/Tests/Telemetry/MetricInsightReadsClickhouse.
 */

const projectId: ObjectID = new ObjectID(
  "5231cccc-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5231cccc-0000-4000-8000-000000000002";
const PAYMENTS: string = "5231cccc-0000-4000-8000-000000000003";
const hourStart: Date = new Date("2026-10-24T08:00:00.000Z");
const startTime: Date = hourStart;
const endTime: Date = new Date("2026-10-24T09:00:00.000Z");
const WHITESPACE: RegExp = /\s+/g;

const metrics: Array<MetricSeriesKey> = [
  { metricName: "http.server.request.count", serviceId: CHECKOUT },
  { metricName: "http.server.duration", serviceId: PAYMENTS },
];

function flat(statement: Statement): string {
  return statement.query.replace(WHITESPACE, " ");
}

// The values a statement sends as query parameters.
function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function stubQuery(
  rows: Array<JSONObject>,
): jest.SpiedFunction<typeof MetricService.executeQuery> {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return jest
    .spyOn(MetricService, "executeQuery")
    .mockResolvedValue(fakeResult as never);
}

function expectInsightReadSettings(query: string): void {
  expect(query).toContain("max_execution_time = 45");
  expect(query).toContain("timeout_overflow_mode = 'throw'");
  expect(query).not.toContain("'break'");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hour's metrics, from the hourly rollup", () => {
  test("every metric by its primary entity, busiest first, in the rollup's one cell for the hour", () => {
    const statement: Statement =
      MetricAggregationService.buildHourlyVolumeStatement({
        projectId,
        hourStart,
        limit: 5000,
      });
    const query: string = flat(statement);

    expect(query).toMatch(
      /^SELECT name, primaryEntityId, countMerge\(sampleCountState\) AS points FROM \{p0:Identifier\} WHERE projectId = \{p1:String\}/,
    );
    // The same day and hour-of-week the rollup's materialized view writes.
    expect(query).toMatch(
      /AND day = toDate\(\{p2:DateTime\}\) AND hourOfWeek = toUInt8\(\(toDayOfWeek\(\{p3:DateTime\}, 1\) - 1\) \* 24 \+ toHour\(\{p4:DateTime\}\)\)/,
    );
    expect(query).toContain(
      "GROUP BY name, primaryEntityId ORDER BY points DESC, name ASC, primaryEntityId ASC LIMIT {p5:Int32}",
    );
    expectInsightReadSettings(query);
    expect(params(statement)).toEqual([
      AnalyticsTableName.MetricBaselineHourly,
      projectId.toString(),
      "2026-10-24 08:00:00",
      "2026-10-24 08:00:00",
      "2026-10-24 08:00:00",
      5000,
    ]);
  });

  test("names with their ids collapsed by the one pattern JavaScript reads them with", () => {
    const statement: Statement =
      MetricAggregationService.buildNamePatternStatement({
        projectId,
        hourStart,
        minNameCount: 50,
        limit: 20,
      });
    const query: string = flat(statement);

    expect(query).toContain(
      "SELECT primaryEntityId, namePattern, uniqExact(name) AS nameCount, sum(points) AS points FROM (SELECT name, primaryEntityId, replaceRegexpAll(name, {p0:String}, {p1:String}) AS namePattern, countMerge(sampleCountState) AS points FROM {p2:Identifier}",
    );
    expect(query).toContain("GROUP BY name, primaryEntityId)");
    expect(query).toMatch(
      /WHERE position\(namePattern, \{p\d+:String\}\) > 0 GROUP BY primaryEntityId, namePattern HAVING nameCount >= \{p\d+:Int32\} ORDER BY nameCount DESC, namePattern ASC, primaryEntityId ASC LIMIT \{p\d+:Int32\}/,
    );
    expectInsightReadSettings(query);

    const values: Array<unknown> = params(statement);

    expect(values.slice(0, 3)).toEqual([
      METRIC_NAME_ID_PATTERN,
      METRIC_NAME_ID_PLACEHOLDER,
      AnalyticsTableName.MetricBaselineHourly,
    ]);
    expect(values.slice(-3)).toEqual([METRIC_NAME_ID_PLACEHOLDER, 50, 20]);
  });

  test("its rows, as the gates read them", () => {
    expect(
      MetricAggregationService.toMetricVolumes([
        {
          name: "http.server.request.count",
          primaryEntityId: CHECKOUT.toUpperCase(),
          points: "48000",
        },
        { name: "", primaryEntityId: CHECKOUT, points: 9 },
        { name: "orphan", primaryEntityId: "", points: 9 },
        { name: "broken", primaryEntityId: CHECKOUT, points: "many" },
        { name: "queue.depth", primaryEntityId: PAYMENTS },
      ]),
    ).toEqual([
      {
        metricName: "http.server.request.count",
        serviceId: CHECKOUT,
        dataPointCount: 48000,
      },
      { metricName: "queue.depth", serviceId: PAYMENTS, dataPointCount: 0 },
    ] as Array<MetricVolumeReading>);

    expect(
      MetricAggregationService.toMetricNamePatterns([
        {
          primaryEntityId: CHECKOUT.toUpperCase(),
          namePattern: "job.{id}.duration",
          nameCount: "1234",
          points: "56000",
        },
        { primaryEntityId: "", namePattern: "x.{id}", nameCount: 60 },
        { primaryEntityId: CHECKOUT, namePattern: "", nameCount: 60 },
        { primaryEntityId: CHECKOUT, namePattern: "y.{id}", nameCount: "?" },
      ]),
    ).toEqual([
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 1234,
        dataPointCount: 56000,
      },
    ] as Array<MetricNamePatternReading>);
  });

  test("read through the metric table's own client", async () => {
    const spy: jest.SpiedFunction<typeof MetricService.executeQuery> =
      stubQuery([
        {
          name: "http.server.request.count",
          primaryEntityId: CHECKOUT,
          points: 9,
        },
      ]);

    expect(
      await MetricAggregationService.getHourlyMetricVolumes({
        projectId,
        hourStart,
        limit: 5000,
      }),
    ).toEqual([
      {
        metricName: "http.server.request.count",
        serviceId: CHECKOUT,
        dataPointCount: 9,
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("a few metrics read closely, by the metric table's sort key", () => {
  test("their data points by kind: buckets summed bucket by bucket over the points with the same bounds", () => {
    const statement: Statement =
      MetricAggregationService.buildMetricShapeStatement({
        projectId,
        startTime,
        endTime,
        metrics,
      });
    const query: string = flat(statement);

    expect(query).toContain(
      "SELECT name, primaryEntityId, ifNull(metricPointType, '') AS pointType, ifNull(aggregationTemporality, '') AS temporality, explicitBounds AS bounds, sumForEach(bucketCounts) AS buckets, sum(ifNull(count, 0)) AS countSum, max(ifNull(count, 0)) AS countMax, min(min) AS minValue, max(max) AS maxValue, count() AS points, countIf(has(attributeKeys, {p0:String})) AS overflowPoints FROM {p1:Identifier} WHERE projectId = {p2:String}",
    );
    expect(query).toContain(
      "AND ((name = {p3:String} AND primaryEntityId = {p4:String}) OR (name = {p5:String} AND primaryEntityId = {p6:String}))",
    );
    expect(query).toContain(
      "AND time >= {p7:DateTime} AND time < {p8:DateTime} AND retentionDate >= now()",
    );
    expect(query).toContain(
      "GROUP BY name, primaryEntityId, pointType, temporality, bounds ORDER BY points DESC, name ASC, primaryEntityId ASC LIMIT {p9:Int32}",
    );
    expectInsightReadSettings(query);
    expect(params(statement)).toEqual([
      OTEL_METRIC_OVERFLOW_ATTRIBUTE,
      AnalyticsTableName.Metric,
      projectId.toString(),
      "http.server.request.count",
      CHECKOUT,
      "http.server.duration",
      PAYMENTS,
      "2026-10-24 08:00:00",
      "2026-10-24 09:00:00",
      MetricAggregationService.INSIGHT_MAX_ROWS,
    ]);
  });

  test("how many values each attribute the code sets took, past the gate, with a sample of them", () => {
    const statement: Statement =
      MetricAggregationService.buildAttributeCardinalityStatement({
        projectId,
        startTime,
        endTime,
        metrics,
        minValueCount: 1000,
        sampleSize: 100,
      });
    const query: string = flat(statement);

    expect(query).toContain(
      `SELECT name, primaryEntityId, key, uniq(attributes[key]) AS valueCount, groupUniqArray(100)(attributes[key]) AS sampleValues FROM ${AnalyticsTableName.Metric} ARRAY JOIN`,
    );
    // Not the resource's, the scope's or OneUptime's own, nor the SDK's mark.
    expect(query).toMatch(
      /ARRAY JOIN arrayFilter\(k -> NOT \(startsWith\(k, \{p\d+:String\}\) OR startsWith\(k, \{p\d+:String\}\) OR startsWith\(k, \{p\d+:String\}\) OR k = \{p\d+:String\}\), attributeKeys\) AS key WHERE projectId = \{p\d+:String\}/,
    );
    expect(query).toContain("AND retentionDate >= now()");
    expect(query).toMatch(
      /GROUP BY name, primaryEntityId, key HAVING valueCount >= \{p\d+:Int32\} ORDER BY valueCount DESC, name ASC, primaryEntityId ASC, key ASC LIMIT \{p\d+:Int32\}/,
    );
    expectInsightReadSettings(query);

    const values: Array<unknown> = params(statement);

    expect(values.slice(0, 5)).toEqual([
      "resource.",
      "scope.",
      "oneuptime.",
      OTEL_METRIC_OVERFLOW_ATTRIBUTE,
      projectId.toString(),
    ]);
    expect(values.slice(-2)).toEqual([
      1000,
      MetricAggregationService.INSIGHT_MAX_ROWS,
    ]);
  });

  test("the sample's size is a count the code chose, written as one whatever it is given", () => {
    const sampleOf: (sampleSize: number) => string = (
      sampleSize: number,
    ): string => {
      const match: RegExpMatchArray | null = flat(
        MetricAggregationService.buildAttributeCardinalityStatement({
          projectId,
          startTime,
          endTime,
          metrics,
          minValueCount: 1000,
          sampleSize,
        }),
      ).match(/groupUniqArray\((\d+)\)/);

      return match?.[1] || "";
    };

    expect(sampleOf(100)).toBe("100");
    expect(sampleOf(2.7)).toBe("2");
    expect(sampleOf(5000)).toBe("1000");
    expect(sampleOf(0)).toBe("1");
    expect(sampleOf(-5)).toBe("1");
    expect(sampleOf(Number.NaN)).toBe("1");
  });

  test("twenty metrics a read at most, and none without a name or a service", () => {
    const many: Array<MetricSeriesKey> = [
      { metricName: "", serviceId: CHECKOUT },
      { metricName: "nameless.service", serviceId: "" },
      ...Array.from(
        { length: 25 },
        (_value: unknown, index: number): MetricSeriesKey => {
          return { metricName: `metric.${index}`, serviceId: CHECKOUT };
        },
      ),
    ];

    expect(MetricAggregationService.toMetricKeys(many)).toHaveLength(
      MetricAggregationService.INSIGHT_MAX_METRICS_PER_READ,
    );
    expect(MetricAggregationService.toMetricKeys(many)[0]).toEqual({
      metricName: "metric.0",
      serviceId: CHECKOUT,
    });

    const query: string = flat(
      MetricAggregationService.buildMetricShapeStatement({
        projectId,
        startTime,
        endTime,
        metrics: many,
      }),
    );

    expect(query.split("(name = ").length - 1).toBe(20);
  });

  test("no metric to read: nothing is asked", async () => {
    const spy: jest.SpiedFunction<typeof MetricService.executeQuery> =
      stubQuery([]);

    expect(
      await MetricAggregationService.getMetricShapes({
        projectId,
        startTime,
        endTime,
        metrics: [{ metricName: "", serviceId: CHECKOUT }],
      }),
    ).toEqual([]);
    expect(
      await MetricAggregationService.getMetricAttributeCardinality({
        projectId,
        startTime,
        endTime,
        metrics: [],
        minValueCount: 1000,
        sampleSize: 100,
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("their rows, as the gates read them", async () => {
    stubQuery([
      {
        name: "http.server.duration",
        primaryEntityId: PAYMENTS.toUpperCase(),
        pointType: "Histogram",
        temporality: "Delta",
        bounds: ["0", "5", "10"],
        buckets: ["0", "1900", "100", "0"],
        countSum: "2000",
        countMax: 40,
        minValue: "0.012",
        maxValue: 4.8,
        points: "60",
        overflowPoints: "0",
      },
      {
        name: "http.server.request.count",
        primaryEntityId: CHECKOUT,
        pointType: "Sum",
        temporality: "",
        bounds: null,
        buckets: null,
        countSum: 0,
        countMax: 0,
        minValue: "",
        maxValue: null,
        points: 900,
        overflowPoints: 3,
      },
      { name: "", primaryEntityId: CHECKOUT },
    ]);

    expect(
      await MetricAggregationService.getMetricShapes({
        projectId,
        startTime,
        endTime,
        metrics,
      }),
    ).toEqual([
      {
        metricName: "http.server.duration",
        serviceId: PAYMENTS,
        pointType: "Histogram",
        temporality: "Delta",
        bounds: [0, 5, 10],
        bucketCounts: [0, 1900, 100, 0],
        countSum: 2000,
        countMax: 40,
        minValue: 0.012,
        maxValue: 4.8,
        dataPointCount: 60,
        overflowDataPointCount: 0,
      },
      {
        metricName: "http.server.request.count",
        serviceId: CHECKOUT,
        pointType: "Sum",
        temporality: "",
        bounds: [],
        bucketCounts: [],
        countSum: 0,
        countMax: 0,
        minValue: null,
        maxValue: null,
        dataPointCount: 900,
        overflowDataPointCount: 3,
      },
    ] as Array<MetricShapeRow>);

    jest.restoreAllMocks();
    stubQuery([
      {
        name: "http.server.request.count",
        primaryEntityId: CHECKOUT.toUpperCase(),
        key: "user.id",
        valueCount: "12000",
        sampleValues: ["a", null, 42],
      },
      {
        name: "http.server.request.count",
        primaryEntityId: CHECKOUT,
        key: "",
        valueCount: 9000,
      },
      {
        name: "http.server.request.count",
        primaryEntityId: CHECKOUT,
        key: "session.id",
        valueCount: 4000,
        sampleValues: "not a list",
      },
    ]);

    expect(
      await MetricAggregationService.getMetricAttributeCardinality({
        projectId,
        startTime,
        endTime,
        metrics,
        minValueCount: 1000,
        sampleSize: 100,
      }),
    ).toEqual([
      {
        metricName: "http.server.request.count",
        serviceId: CHECKOUT,
        key: "user.id",
        valueCount: 12000,
        sampleValues: ["a", "", "42"],
      },
      {
        metricName: "http.server.request.count",
        serviceId: CHECKOUT,
        key: "session.id",
        valueCount: 4000,
        sampleValues: [],
      },
    ] as Array<MetricAttributeCardinalityRow>);
  });
});
