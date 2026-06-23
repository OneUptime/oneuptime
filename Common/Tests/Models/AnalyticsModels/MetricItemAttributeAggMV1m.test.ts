import MetricItemAttributeAggMV1m from "../../../Models/AnalyticsModels/MetricItemAttributeAggMV1m";
import MetricItemAttributeAggMV1mService from "../../../Server/Services/MetricItemAttributeAggMV1mService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import { describe, expect, test } from "@jest/globals";

describe("MetricItemAttributeAggMV1m", () => {
  test("defines the selected attribute rollup table and materialized view", () => {
    const model: MetricItemAttributeAggMV1m = new MetricItemAttributeAggMV1m();

    expect(model.tableName).toBe(AnalyticsTableName.MetricItemAttributeAggMV1m);
    expect(model.materializedViews).toHaveLength(1);
    expect(model.materializedViews[0]?.name).toBe(
      "MetricItemAttributeAggMV1m_mv",
    );
    expect(model.materializedViews[0]?.query).toContain(
      "ARRAY JOIN arrayFilter",
    );
    expect(model.materializedViews[0]?.query).toContain(
      "resource.k8s.cluster.name",
    );
    expect(model.materializedViews[0]?.query).toContain(
      "GROUP BY projectId, name, primaryEntityId, attributeKey, attributeValue, bucketTime",
    );
    expect(model.primaryKeys).toStrictEqual([
      "projectId",
      "name",
      "primaryEntityId",
      "attributeKey",
      "attributeValue",
      "bucketTime",
    ]);
  });

  test("registers a typed service for boot-time schema sync", () => {
    expect(MetricItemAttributeAggMV1mService.model.tableName).toBe(
      AnalyticsTableName.MetricItemAttributeAggMV1m,
    );
  });

  test("falls back to minute milliseconds for unknown intervals", () => {
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        "unknown" as unknown as AggregationInterval,
      ),
    ).toBe(1000 * 60);
  });
});
