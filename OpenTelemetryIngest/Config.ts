let concurrency: string | number =
  process.env["OPEN_TELEMETRY_INGEST_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const OPEN_TELEMETRY_INGEST_CONCURRENCY: number = concurrency as number;

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

export const OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE: number =
  parseBatchSize("OPEN_TELEMETRY_INGEST_LOG_FLUSH_BATCH_SIZE", 1000);

export const OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE: number =
  parseBatchSize("OPEN_TELEMETRY_INGEST_METRIC_FLUSH_BATCH_SIZE", 750);

export const OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE: number =
  parseBatchSize("OPEN_TELEMETRY_INGEST_TRACE_FLUSH_BATCH_SIZE", 750);

export const OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE: number =
  parseBatchSize("OPEN_TELEMETRY_INGEST_EXCEPTION_FLUSH_BATCH_SIZE", 500);

/*
 * Some telemetry batches can be large and take >30s (BullMQ default lock) to process.
 * Allow configuring a longer lock duration (in ms) to avoid premature stall detection.
 */

// 10 minutes.
export const OPEN_TELEMETRY_INGEST_LOCK_DURATION_MS: number = 10 * 60 * 1000;
