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

export const TELEMETRY_LOG_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_LOG_FLUSH_BATCH_SIZE",
  1000,
);

export const TELEMETRY_METRIC_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_METRIC_FLUSH_BATCH_SIZE",
  750,
);

export const TELEMETRY_TRACE_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_TRACE_FLUSH_BATCH_SIZE",
  750,
);

export const TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_EXCEPTION_FLUSH_BATCH_SIZE",
  500,
);

export const TELEMETRY_PROFILE_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_PROFILE_FLUSH_BATCH_SIZE",
  500,
);

export const TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE: number = parseBatchSize(
  "TELEMETRY_PROFILE_SAMPLE_FLUSH_BATCH_SIZE",
  500,
);

/*
 * Detect exceptions inside ingested logs (explicit OTel exception.* attributes,
 * and error/fatal log bodies that contain a stack trace) and roll them up into
 * the same Issues view that trace span-event exceptions feed. On by default;
 * set TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED=false to hot-disable the whole
 * extraction block on the log ingest hot path without a code change.
 */
export const TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED: boolean =
  process.env["TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED"] !== "false";

/*
 * Coalesce same-monitor Incoming Request ingest jobs at enqueue time so an
 * external sender hammering one monitor's incoming-request URL cannot fan out
 * into many concurrent monitorResource() calls that contend on the per-monitor
 * Redis lock (the "Acquire mutex ... timeout" storm). On by default; set
 * INCOMING_REQUEST_INGEST_COALESCE_ENABLED=false to disable the BullMQ
 * deduplication on the ingest hot path without a code change.
 */
export const INCOMING_REQUEST_INGEST_COALESCE_ENABLED: boolean =
  process.env["INCOMING_REQUEST_INGEST_COALESCE_ENABLED"] !== "false";

/*
 * Some telemetry batches can be large and take >30s (BullMQ default lock) to process.
 * Allow configuring a longer lock duration (in ms) to avoid premature stall detection.
 */

// 10 minutes.
export const TELEMETRY_LOCK_DURATION_MS: number = 10 * 60 * 1000;

/*
 * Instance-level kill switch for session replay ingest. On by default,
 * following the `!== "false"` idiom used by the other hot-path switches
 * above, so ops can stop accepting recordings without a deploy and without
 * touching per-project settings. This is distinct from
 * SESSION_REPLAY_ENABLED_BY_DEFAULT, which controls whether a *recorder* is
 * told to record at all.
 */
export const SESSION_REPLAY_INGEST_ENABLED: boolean =
  process.env["SESSION_REPLAY_INGEST_ENABLED"] !== "false";

/*
 * Whether a newly-configured deployment offers session replay at all.
 *
 * Defaults to FALSE, and stays false on self-hosted installs, because plan
 * gating is a no-op when BILLING_ENABLED=false: `tableBillingAccessControl`
 * is only consulted when billing is on. Without this switch nothing would
 * stop a self-hosted install from running 100% sampling at 90-day retention
 * on a single ClickHouse node - and because replay is the fattest table,
 * the capacity pruner would then start dropping partitions, potentially
 * destroying the customer's logs and traces to make room for recordings.
 */
export const SESSION_REPLAY_ENABLED_BY_DEFAULT: boolean =
  process.env["SESSION_REPLAY_ENABLED_BY_DEFAULT"] === "true";

/*
 * Per-project chunk rate ceiling, enforced with a Redis counter so it holds
 * across every app pod rather than per process. 20k chunks/min is roughly
 * 1,400 concurrently-recording tabs at the 15s flush cadence - far above
 * any legitimate single project, and low enough to blunt a scraped-key
 * flood. Exceeding it answers 429 with Retry-After.
 */
export const SESSION_REPLAY_MAX_CHUNKS_PER_PROJECT_PER_MINUTE: number =
  parseBatchSize("SESSION_REPLAY_MAX_CHUNKS_PER_PROJECT_PER_MINUTE", 20000);

/*
 * Per-project daily byte budget. This is the control that protects a
 * self-hosted cluster's disk regardless of billing, so it is enforced in
 * the gate rather than reported after the fact. Exceeding it answers 204
 * with directive "stop", which makes live recorders stand down instead of
 * retrying.
 */
export const SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY: number =
  parseBatchSize(
    "SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY",
    1024 * 1024 * 1024,
  );

/*
 * Chunks at or under this size ride inline in the BullMQ job as base64
 * instead of being staged in Redis. A typical chunk is ~7KB, so this keeps
 * ~99% of chunks out of the staging store entirely and bounds its
 * worst-case footprint to tens of MB. 64KiB is chosen so that even at the
 * 33% base64 inflation a job stays small relative to BullMQ's own
 * JSON-serialized job state.
 */
export const SESSION_REPLAY_INLINE_STAGING_MAX_BYTES: number = parseBatchSize(
  "SESSION_REPLAY_INLINE_STAGING_MAX_BYTES",
  64 * 1024,
);

/*
 * Replay's share of the shared telemetry worker's concurrency slots.
 *
 * The telemetry queue is deliberately reused (a new QueueName means a new
 * worker deployment plus a KEDA scaler), which means a replay backlog would
 * otherwise be able to occupy all TELEMETRY_CONCURRENCY slots and starve
 * trace and log ingest. This is a per-pod in-process gate rather than a
 * distributed Semaphore: TELEMETRY_CONCURRENCY is itself per-pod, so a
 * per-pod cap is the right unit, and it costs no Redis round trip on a path
 * whose whole budget is a few milliseconds per chunk.
 */
export const SESSION_REPLAY_WORKER_CONCURRENCY: number = parseBatchSize(
  "SESSION_REPLAY_WORKER_CONCURRENCY",
  20,
);

/*
 * Pinned recorder artifact the loader stub is told to import. Changing this
 * one value is the staged-rollout and instant-rollback mechanism for the
 * browser recorder - which matters because a masking regression would
 * otherwise be live in customer browsers for the full cache TTL with no
 * remedy.
 */
export const SESSION_REPLAY_RECORDER_VERSION: string =
  process.env["SESSION_REPLAY_RECORDER_VERSION"] || "1.0.0";

/*
 * MQTT ingestion for IoT devices. On by default (like the gRPC OTLP
 * listener); set MQTT_INGEST_ENABLED=false to skip starting both the
 * TCP listener and the WebSocket endpoint without a code change.
 */
export const MQTT_INGEST_ENABLED: boolean =
  process.env["MQTT_INGEST_ENABLED"] !== "false";

// Raw MQTT TCP listener port inside the app container.
export const MQTT_INGEST_PORT: number = parseBatchSize(
  "MQTT_INGEST_PORT",
  1883,
);

/*
 * MQTT-over-WebSocket path on the main HTTP server. Rides the
 * existing Nginx ingress on 80/443 (see the /mqtt location block),
 * the same way the socket.io /realtime path does.
 */
export const MQTT_WEBSOCKET_PATH: string = "/mqtt";
