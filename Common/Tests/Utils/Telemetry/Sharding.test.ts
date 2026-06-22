import {
  getClickhouseClusterName,
  getClickhouseTelemetryDistributedTableName,
  getClickhouseTelemetryShardingKey,
  isClickhouseTelemetryShardingEnabled,
  isClickhouseTelemetryTableSharded,
} from "../../../Utils/Telemetry/Sharding";

describe("Telemetry sharding config", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("keeps local table names when sharding is disabled", () => {
    delete process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"];
    delete process.env["CLICKHOUSE_CLUSTER_NAME"];

    expect(isClickhouseTelemetryShardingEnabled()).toBe(false);
    expect(getClickhouseClusterName()).toBeUndefined();
    expect(isClickhouseTelemetryTableSharded("MetricItemV3")).toBe(false);
    expect(getClickhouseTelemetryDistributedTableName("MetricItemV3")).toBe(
      "MetricItemV3",
    );
  });

  test("builds distributed telemetry table names when enabled", () => {
    process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"] = "true";
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "ou";

    expect(isClickhouseTelemetryShardingEnabled()).toBe(true);
    expect(getClickhouseClusterName()).toBe("ou");
    expect(isClickhouseTelemetryTableSharded("MetricItemV3")).toBe(true);
    expect(getClickhouseTelemetryDistributedTableName("MetricItemV3")).toBe(
      "MetricItemV3Distributed",
    );
    expect(getClickhouseTelemetryShardingKey()).toBe("cityHash64(projectId)");
  });

  test("does not shard non-telemetry analytics tables", () => {
    process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"] = "true";
    process.env["CLICKHOUSE_CLUSTER_NAME"] = "ou";

    expect(isClickhouseTelemetryTableSharded("AuditLogV2")).toBe(false);
    expect(getClickhouseTelemetryDistributedTableName("AuditLogV2")).toBe(
      "AuditLogV2",
    );
  });
});
