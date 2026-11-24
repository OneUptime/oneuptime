import LogNumericAttributeSql from "../../../../Server/Utils/Telemetry/LogNumericAttributeSql";
import LogRecordingRuleQuery from "../../../../Server/Utils/Telemetry/LogRecordingRuleQuery";
import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A NUMBER IN A LOG'S ATTRIBUTES IS READ ONE WAY (#7716).
 *
 * A log recording rule's minute and the log explorer's Analytics both
 * aggregate a numeric attribute. They read it through LogNumericAttributeSql,
 * so a chart and the rule made from it compute the same values: these pin
 * what the helper writes, and that both reads write exactly it.
 */

describe("the value, the filter and the aggregate", () => {
  test("the value is the attribute read as a Float64, NULL when it is no number", () => {
    const statement: Statement =
      LogNumericAttributeSql.buildValueExpression("duration_ms");

    expect(statement.query).toBe("toFloat64OrNull(attributes[{p0:String}])");
    expect(statement.query_params).toEqual({ p0: "duration_ms" });
  });

  test("the filter keeps a log whose value is a finite number, riding the keys' bloom index first", () => {
    const statement: Statement = SQL`SELECT 1 WHERE 1`;

    LogNumericAttributeSql.appendIsNumberFilter(statement, "bytes");

    expect(statement.query).toBe(
      "SELECT 1 WHERE 1 AND (empty(attributeKeys) OR hasAny(attributeKeys, {p0:Array(String)})) AND isFinite(toFloat64OrNull(attributes[{p1:String}]))",
    );
    expect(statement.query_params).toEqual({ p0: ["bytes"], p1: "bytes" });
  });

  test.each([
    [AggregationType.Sum, "sum("],
    [AggregationType.Avg, "avg("],
    [AggregationType.Min, "min("],
    [AggregationType.Max, "max("],
    [AggregationType.P50, "quantile(0.5)("],
    [AggregationType.P75, "quantile(0.75)("],
    [AggregationType.P90, "quantile(0.9)("],
    [AggregationType.P95, "quantile(0.95)("],
    [AggregationType.P99, "quantile(0.99)("],
  ])(
    "%s is ClickHouse's own aggregate: %s",
    (aggregationType: AggregationType, functionCall: string) => {
      const statement: Statement =
        LogNumericAttributeSql.buildAggregateExpression(
          aggregationType,
          "duration_ms",
        );

      expect(statement.query).toBe(
        `${functionCall}toFloat64OrNull(attributes[{p0:String}]))`,
      );
      expect(statement.query_params).toEqual({ p0: "duration_ms" });
    },
  );

  test("a count is no aggregate of a number, and says what is", () => {
    expect(() => {
      return LogNumericAttributeSql.buildAggregateExpression(
        AggregationType.Count,
        "duration_ms",
      );
    }).toThrow(BadDataException);

    expect(() => {
      return LogNumericAttributeSql.buildAggregateExpression(
        AggregationType.Count,
        "duration_ms",
      );
    }).toThrow(
      "A numeric log attribute cannot be aggregated as Count. Use a sum, an average, a minimum, a maximum or a percentile.",
    );
  });

  test("the key is never written into the SQL, whatever it holds", () => {
    const key: string = "x') OR 1=1 --";
    const statement: Statement = SQL`SELECT `;

    statement.append(
      LogNumericAttributeSql.buildAggregateExpression(AggregationType.Avg, key),
    );
    LogNumericAttributeSql.appendIsNumberFilter(statement, key);

    expect(statement.query).not.toContain(key);
    expect(statement.query).not.toContain("OR 1=1");
    expect(Object.values(statement.query_params)).toEqual([key, [key], key]);
  });
});

describe("a recording rule and a chart read a number the same way", () => {
  const projectId: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );

  // The aggregate and the number filter of a statement, its keys as $key.
  function numericPartsOf(statement: Statement): {
    aggregate: string;
    filter: string;
  } {
    const query: string = statement.query.replace(/\s+/g, " ");
    const aggregate: string =
      query.match(
        /(sum|avg|min|max|quantile\([\d.]+\))\(toFloat64OrNull\(attributes\[\{p\d+:String\}\]\)\)/,
      )?.[0] || "";
    const filter: string =
      query.match(
        /AND \(empty\(attributeKeys\) OR hasAny\(attributeKeys, \{p\d+:Array\(String\)\}\)\) AND isFinite\(toFloat64OrNull\(attributes\[\{p\d+:String\}\]\)\)/,
      )?.[0] || "";

    return {
      aggregate: aggregate.replace(/\{p\d+:/g, "{$key:"),
      filter: filter.replace(/\{p\d+:/g, "{$key:"),
    };
  }

  test.each([
    ["sum", AggregationType.Sum],
    ["avg", AggregationType.Avg],
    ["min", AggregationType.Min],
    ["max", AggregationType.Max],
    ["p50", AggregationType.P50],
    ["p90", AggregationType.P90],
    ["p95", AggregationType.P95],
    ["p99", AggregationType.P99],
  ])(
    "the chart's %s is the rule's %s",
    (chartAggregation: string, ruleAggregation: AggregationType) => {
      const rule: Statement = LogRecordingRuleQuery.buildStatement({
        projectId,
        definition: {
          filter: {},
          aggregationType: ruleAggregation,
          valueAttribute: "latency",
          groupByAttributes: [],
        },
        window: {
          startTime: new Date("2026-11-19T09:00:00.000Z"),
          endTime: new Date("2026-11-19T09:02:00.000Z"),
          minutes: 2,
          skippedMinutes: 0,
        },
      });

      const chart: Statement = (
        LogAggregationService as unknown as {
          buildAnalyticsTimeseriesStatement: (request: unknown) => Statement;
        }
      ).buildAnalyticsTimeseriesStatement({
        projectId,
        startTime: new Date("2026-11-19T09:00:00.000Z"),
        endTime: new Date("2026-11-19T09:02:00.000Z"),
        bucketSizeInMinutes: 1,
        chartType: "timeseries",
        aggregation: chartAggregation,
        aggregationField: "latency",
      });

      const ruleParts: { aggregate: string; filter: string } =
        numericPartsOf(rule);
      const chartParts: { aggregate: string; filter: string } =
        numericPartsOf(chart);

      expect(ruleParts.aggregate).not.toBe("");
      expect(ruleParts.filter).not.toBe("");
      expect(chartParts).toEqual(ruleParts);
    },
  );
});
