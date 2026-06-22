export type TelemetryColdTierSignal = "logs" | "metrics" | "traces";

const DEFAULT_DELETE_TTL_EXPRESSION: string = "retentionDate DELETE";
const DEFAULT_STORAGE_POLICY: string = "tiered";
const DEFAULT_VOLUME_NAME: string = "s3_cold";

const parsePositiveIntEnv: (
  envKey: string,
  fallback: number,
) => number = (envKey: string, fallback: number): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

export const isClickhouseColdTierEnabled: () => boolean = (): boolean => {
  return process.env["CLICKHOUSE_COLD_TIER_ENABLED"] === "true";
};

export const getClickhouseColdTierStoragePolicy: () => string | undefined = (): string | undefined => {
  if (!isClickhouseColdTierEnabled()) {
    return undefined;
  }

  return (
    process.env["CLICKHOUSE_COLD_TIER_STORAGE_POLICY"] ||
    DEFAULT_STORAGE_POLICY
  );
};

export const getClickhouseColdTierVolumeName: () => string = (): string => {
  return process.env["CLICKHOUSE_COLD_TIER_VOLUME"] || DEFAULT_VOLUME_NAME;
};

export const getClickhouseColdTierRetentionDays: (
  signal: TelemetryColdTierSignal,
) => number = (signal: TelemetryColdTierSignal): number => {
  switch (signal) {
    case "metrics":
      return parsePositiveIntEnv("CLICKHOUSE_COLD_TIER_METRICS_DAYS", 7);
    case "logs":
      return parsePositiveIntEnv("CLICKHOUSE_COLD_TIER_LOGS_DAYS", 7);
    case "traces":
      return parsePositiveIntEnv("CLICKHOUSE_COLD_TIER_TRACES_DAYS", 3);
  }
};

export const getTelemetryColdTierTtlExpression: (options: {
  signal: TelemetryColdTierSignal;
  moveAfterExpression: string;
  deleteAfterExpression?: string;
}) => string = (options: {
  signal: TelemetryColdTierSignal;
  moveAfterExpression: string;
  deleteAfterExpression?: string;
}): string => {
  const deleteAfterExpression: string =
    options.deleteAfterExpression || DEFAULT_DELETE_TTL_EXPRESSION;

  if (!isClickhouseColdTierEnabled()) {
    return deleteAfterExpression;
  }

  return `${options.moveAfterExpression} + INTERVAL ${getClickhouseColdTierRetentionDays(options.signal)} DAY TO VOLUME '${getClickhouseColdTierVolumeName()}', ${deleteAfterExpression}`;
};
