import Metric from "../../../Models/AnalyticsModels/Metric";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import Profile from "../../../Models/AnalyticsModels/Profile";
import ProfileSample from "../../../Models/AnalyticsModels/ProfileSample";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import MetricItemAggMV1m from "../../../Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "../../../Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricBaselineHourly from "../../../Models/AnalyticsModels/MetricBaselineHourly";
import type AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";

type ModelCtor = new () => AnalyticsBaseModel;

type ColdTierModelExpectation = {
  ctor: ModelCtor;
  tableName: string;
  moveMarker: string;
};

const coldTierModels: ReadonlyArray<ColdTierModelExpectation> = [
  {
    ctor: Metric,
    tableName: "MetricItemV3",
    moveMarker: "time + INTERVAL 7 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: Log,
    tableName: "LogItemV3",
    moveMarker: "time + INTERVAL 7 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: Span,
    tableName: "SpanItemV3",
    moveMarker: "startTime + INTERVAL 3 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: Profile,
    tableName: "ProfileItemV3",
    moveMarker: "startTime + INTERVAL 3 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: ProfileSample,
    tableName: "ProfileSampleItemV3",
    moveMarker: "time + INTERVAL 3 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: ExceptionInstance,
    tableName: "ExceptionItemV3",
    moveMarker: "time + INTERVAL 3 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: MonitorLog,
    tableName: "MonitorLogV3",
    moveMarker: "time + INTERVAL 7 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: MetricItemAggMV1m,
    tableName: "MetricItemAggMV1m",
    moveMarker: "bucketTime + INTERVAL 7 DAY TO VOLUME 's3_cold'",
  },
  {
    ctor: MetricItemAggMV1mByHostV2,
    tableName: "MetricItemAggMV1mByHostV2",
    moveMarker: "bucketTime + INTERVAL 7 DAY TO VOLUME 's3_cold'",
  },
];

describe("Telemetry analytics model storage layout", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("enables cold-tier and distributed wrappers for telemetry tables", () => {
    process.env["CLICKHOUSE_COLD_TIER_ENABLED"] = "true";
    process.env["CLICKHOUSE_COLD_TIER_STORAGE_POLICY"] = "tiered";
    process.env["CLICKHOUSE_COLD_TIER_VOLUME"] = "s3_cold";
    process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"] = "true";
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "ou";

    for (const expectation of coldTierModels) {
      const model: AnalyticsBaseModel = new expectation.ctor();

      expect(model.getSchemaTableName()).toBe(expectation.tableName);
      expect(model.getReadTableName()).toBe(
        `${expectation.tableName}Distributed`,
      );
      expect(model.getWriteTableName()).toBe(
        `${expectation.tableName}Distributed`,
      );
      expect(model.getMutationTableName()).toBe(expectation.tableName);
      expect(model.distributedTableName).toBe(
        `${expectation.tableName}Distributed`,
      );
      expect(model.distributedClusterName).toBe("ou");
      expect(model.distributedShardingKey).toBe("cityHash64(projectId)");
      expect(model.storagePolicy).toBe("tiered");
      expect(model.ttlExpression).toContain(expectation.moveMarker);
      expect(model.ttlExpression).toContain("retentionDate DELETE");
    }

    const baseline: MetricBaselineHourly = new MetricBaselineHourly();
    expect(baseline.getSchemaTableName()).toBe("MetricBaselineHourly");
    expect(baseline.getReadTableName()).toBe("MetricBaselineHourlyDistributed");
    expect(baseline.getWriteTableName()).toBe(
      "MetricBaselineHourlyDistributed",
    );
    expect(baseline.getMutationTableName()).toBe("MetricBaselineHourly");
    expect(baseline.distributedTableName).toBe(
      "MetricBaselineHourlyDistributed",
    );
    expect(baseline.distributedClusterName).toBe("ou");
    expect(baseline.distributedShardingKey).toBe("cityHash64(projectId)");
    expect(baseline.storagePolicy).toBeUndefined();
    expect(baseline.ttlExpression).toBe("day + INTERVAL 90 DAY");
  });

  test("keeps historical non-sharded hot-tier defaults when disabled", () => {
    delete process.env["CLICKHOUSE_COLD_TIER_ENABLED"];
    delete process.env["CLICKHOUSE_COLD_TIER_STORAGE_POLICY"];
    delete process.env["CLICKHOUSE_COLD_TIER_VOLUME"];
    delete process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"];
    delete process.env["CLICKHOUSE_CLUSTER_NAME"];

    for (const expectation of coldTierModels) {
      const model: AnalyticsBaseModel = new expectation.ctor();

      expect(model.getSchemaTableName()).toBe(expectation.tableName);
      expect(model.getReadTableName()).toBe(expectation.tableName);
      expect(model.getWriteTableName()).toBe(expectation.tableName);
      expect(model.getMutationTableName()).toBe(expectation.tableName);
      expect(model.distributedTableName).toBeUndefined();
      expect(model.distributedClusterName).toBeUndefined();
      expect(model.distributedShardingKey).toBeUndefined();
      expect(model.storagePolicy).toBeUndefined();
      expect(model.ttlExpression).not.toContain("TO VOLUME 's3_cold'");
      expect(model.ttlExpression).toContain("DELETE");
    }

    const baseline: MetricBaselineHourly = new MetricBaselineHourly();
    expect(baseline.distributedTableName).toBeUndefined();
    expect(baseline.storagePolicy).toBeUndefined();
    expect(baseline.ttlExpression).toBe("day + INTERVAL 90 DAY");
  });
});
