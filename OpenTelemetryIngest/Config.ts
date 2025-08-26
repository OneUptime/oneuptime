let concurrency: string | number =
  process.env["OPEN_TELEMETRY_INGEST_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const OPEN_TELEMETRY_INGEST_CONCURRENCY: number = concurrency as number;

// Some telemetry batches can be large and take >30s (BullMQ default lock) to process.
// Allow configuring a longer lock duration (in ms) to avoid premature stall detection.

// 10 minutes.
export const OPEN_TELEMETRY_INGEST_LOCK_DURATION_MS: number = 10 * 60 * 1000;