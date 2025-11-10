let concurrency: string | number = process.env["TELEMETRY_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const TELEMETRY_CONCURRENCY: number = concurrency as number;

type ParseBatchSizeFunction = (envKey: string, defaultValue: number) => number;

const parseBatchSize: ParseBatchSizeFunction = (
  envKey: string,
  defaultValue: number,
): number => {
  const value: string | undefined = process.env[envKey];

  if (!value) {
    return defaultValue;
  }

  const parsed: number = parseInt(value, 10);

  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
};

export const TELEMETRY_LOG_FLUSH_BATCH_SIZE: number =
  parseBatchSize("TELEMETRY_LOG_FLUSH_BATCH_SIZE", 1000);

export const TELEMETRY_METRIC_FLUSH_BATCH_SIZE: number =
  parseBatchSize("TELEMETRY_METRIC_FLUSH_BATCH_SIZE", 750);

export const TELEMETRY_TRACE_FLUSH_BATCH_SIZE: number =
  parseBatchSize("TELEMETRY_TRACE_FLUSH_BATCH_SIZE", 750);

export const TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE: number =
  parseBatchSize("TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE", 500);

/*
 * Some telemetry batches can be large and take >30s (BullMQ default lock) to process.
 * Allow configuring a longer lock duration (in ms) to avoid premature stall detection.
 */

// 10 minutes.
export const TELEMETRY_LOCK_DURATION_MS: number = 10 * 60 * 1000;
