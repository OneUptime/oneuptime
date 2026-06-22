import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";

const DISTRIBUTED_TABLE_SUFFIX: string = "Distributed";

const shardedTelemetryTableMap: Record<string, true> = {
  [AnalyticsTableName.Log]: true,
  [AnalyticsTableName.Metric]: true,
  [AnalyticsTableName.ExceptionInstance]: true,
  [AnalyticsTableName.Span]: true,
  [AnalyticsTableName.MonitorLog]: true,
  [AnalyticsTableName.Profile]: true,
  [AnalyticsTableName.ProfileSample]: true,
  [AnalyticsTableName.MetricItemAggMV1m]: true,
  [AnalyticsTableName.MetricItemAggMV1mByHostV2]: true,
  [AnalyticsTableName.MetricBaselineHourly]: true,
};

export const isClickhouseTelemetryShardingEnabled: () => boolean = (): boolean => {
  return process.env["CLICKHOUSE_TELEMETRY_SHARDING_ENABLED"] === "true";
};

export const getClickhouseClusterName: () => string | undefined = (): string | undefined => {
  if (!isClickhouseTelemetryShardingEnabled()) {
    return undefined;
  }

  return process.env["CLICKHOUSE_CLUSTER_NAME"] || undefined;
};

export const isClickhouseTelemetryTableSharded: (
  tableName: string,
) => boolean = (tableName: string): boolean => {
  return (
    isClickhouseTelemetryShardingEnabled() &&
    Boolean(getClickhouseClusterName()) &&
    Boolean(shardedTelemetryTableMap[tableName])
  );
};

export const getClickhouseTelemetryDistributedTableName: (
  tableName: string,
) => string = (tableName: string): string => {
  if (!isClickhouseTelemetryTableSharded(tableName)) {
    return tableName;
  }

  return `${tableName}${DISTRIBUTED_TABLE_SUFFIX}`;
};

export const getClickhouseTelemetryShardingKey: () => string = (): string => {
  return "cityHash64(projectId)";
};
