import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import Query from "../../../Server/Types/AnalyticsDatabase/Query";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import { describe, expect, afterEach, jest, test } from "@jest/globals";

function buildAggregateBy(
  aggregationType: AggregationType,
): AggregateBy<Metric> {
  const query: Query<Metric> = {
    name: "istio_request_duration_milliseconds",
  };

  return {
    aggregateColumnName: "value",
    aggregationType,
    aggregationTimestampColumnName: "time",
    startTimestamp: new Date("2026-06-23T00:00:00.000Z"),
    endTimestamp: new Date("2026-06-23T06:00:00.000Z"),
    query,
    limit: 10000,
    skip: 0,
    sort: {
      time: SortOrder.Descending,
    },
    props: {},
    groupByAttributeKeys: ["resource.k8s.cluster.name"],
  } satisfies AggregateBy<Metric>;
}

describe("MetricService selected attribute group-by", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("uses attribute rollup MV for scalar allowlisted attribute group-by", () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    const service: MetricService = new MetricService();
    const { statement, columns } = service.toAggregateStatement(
      buildAggregateBy(AggregationType.Avg),
    );

    expect(columns).toStrictEqual(["value", "time", "attributes"]);
    expect(statement.query).toContain("MetricItemAttributeAggMV1m");
    expect(statement.query).toContain("attributeKey =");
    expect(statement.query).toContain("map(");
    expect(statement.query).toContain("GROUP BY time, attributeValue");
    expect(statement.query).toContain(
      "attributeValue IN (SELECT attributeValue",
    );
    expect(statement.query).toContain("LIMIT {");
    expect(statement.query).not.toContain("FROM oneuptime.MetricItemV3");
    expect(Object.values(statement.query_params)).toContain(
      "resource.k8s.cluster.name",
    );
  });

  test("skips top-series subquery when exact selected attribute filter exists", () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    const aggregateBy: AggregateBy<Metric> = buildAggregateBy(
      AggregationType.Avg,
    );
    /*
     * Query<Metric> is deeply recursive around map-style filters; this test
     * only needs the runtime request shape that the dashboard API sends.
     */
    aggregateBy.query = {
      name: "istio_request_duration_milliseconds",
      attributes: {
        "resource.k8s.cluster.name": "internal-seoul-eks",
      },
    } as unknown as Query<Metric>;

    const service: MetricService = new MetricService();
    const { statement } = service.toAggregateStatement(aggregateBy);

    expect(statement.query).toContain("attributeValue =");
    expect(statement.query).not.toContain(
      "attributeValue IN (SELECT attributeValue",
    );
    expect(Object.values(statement.query_params)).toContain(
      "internal-seoul-eks",
    );
  });

  test("falls back to raw rows for non-allowlisted scalar attribute group-by", () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    const aggregateBy: AggregateBy<Metric> = buildAggregateBy(
      AggregationType.Avg,
    );
    aggregateBy.groupByAttributeKeys = ["resource.k8s.pod.name"];

    const service: MetricService = new MetricService();
    const { statement } = service.toAggregateStatement(aggregateBy);

    expect(statement.query).toContain("FROM oneuptime.MetricItemV3");
    expect(statement.query).toContain("GROUP BY time, __attr_0");
    expect(statement.query).not.toContain("MetricItemAttributeAggMV1m");
  });

  test("keeps histogram-aware percentile aggregation for selected attribute group-by", () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    const service: MetricService = new MetricService();
    const { statement, columns } = service.toAggregateStatement(
      buildAggregateBy(AggregationType.P95),
    );

    expect(columns).toStrictEqual(["value", "time", "attributes"]);
    expect(statement.query).toContain("quantileExactWeighted(0.95)");
    expect(statement.query).toContain("arrayJoin(");
    expect(statement.query).toContain("metricPointType = 'Histogram'");
    expect(statement.query).toContain("attributes[{p");
    expect(statement.query).not.toContain(
      "GROUP BY {p3:Identifier}, attributes",
    );
    expect(Object.values(statement.query_params)).toContain(
      "resource.k8s.cluster.name",
    );
  });
});
