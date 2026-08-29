import { DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY } from "Common/Types/Rum/SessionReplay";

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
 * Defaults to TRUE. Session replay is on out of the box, and this switch is
 * how an operator turns it OFF for the whole instance:
 * SESSION_REPLAY_ENABLED_BY_DEFAULT=false makes the config endpoint answer
 * `enabled:false, directive:"stop"` for every application, so recorders
 * already live on customer pages stop recording rather than merely stopping
 * uploads.
 *
 * The comment here used to say the opposite - "defaults to FALSE, and stays
 * false on self-hosted installs" - and so did the self-hosted docs, which
 * told operators to set it to `true` to ENABLE the feature. Both described
 * the reverse of the one-line expression below, so an operator following the
 * docs performed a no-op believing they had enabled it, and the value that
 * actually does something (`false`) was documented nowhere.
 *
 * The concern behind the old comment is real and unchanged: plan gating is a
 * no-op when BILLING_ENABLED=false, so nothing stops a self-hosted install
 * from running 100% sampling at long retention on a single ClickHouse node -
 * and because replay is the fattest table, the capacity pruner could start
 * dropping partitions, destroying that customer's logs and traces to make
 * room for recordings. SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY is the
 * bound for that, and the self-hosted docs now say so.
 */
export const SESSION_REPLAY_ENABLED_BY_DEFAULT: boolean =
  process.env["SESSION_REPLAY_ENABLED_BY_DEFAULT"] !== "false";

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
    DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
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
 * How many replay chunks one pod may decode and scrub concurrently.
 *
 * This bounds replay's peak CPU and memory on the shared telemetry worker:
 * every decoded chunk stays resident until its insert is submitted, so
 * without a cap the ceiling would be TELEMETRY_CONCURRENCY times the
 * per-job decompression budget. It is NOT starvation protection - the gate
 * is applied inside the job handler, so a waiting replay job still holds its
 * BullMQ slot (see withSessionReplaySlot in ProcessTelemetry).
 *
 * Per-pod in-process rather than a distributed Semaphore: TELEMETRY_
 * CONCURRENCY is itself per-pod, so a per-pod cap is the right unit, and it
 * costs no Redis round trip on a path whose whole budget is a few
 * milliseconds per chunk.
 */
export const SESSION_REPLAY_WORKER_CONCURRENCY: number = parseBatchSize(
  "SESSION_REPLAY_WORKER_CONCURRENCY",
  20,
);

/*
 * Name of the ONE request header whose country code the replay ingest path
 * is allowed to believe, lowercased (e.g. "cf-ipcountry" behind Cloudflare,
 * "x-vercel-ip-country" behind Vercel).
 *
 * Empty by default, which means no country is recorded at all. A request
 * header is client-controlled unless the ingress overwrites it, and nothing
 * in the Nginx config strips these, so honouring one on a deployment that is
 * not actually behind that CDN lets any client stamp arbitrary countries onto
 * session rows. Set it only when the named header is guaranteed to be
 * rewritten by your edge.
 */
export const SESSION_REPLAY_TRUSTED_GEO_HEADER: string = (
  process.env["SESSION_REPLAY_TRUSTED_GEO_HEADER"] || ""
)
  .trim()
  .toLowerCase();

/*
 * SESSION_REPLAY_RECORDER_VERSION used to live here, described as "the
 * staged-rollout and instant-rollback mechanism for the browser recorder".
 * It was not: the config endpoint reads the published version out of the
 * BUILD MANIFEST (BrowserRecorder/Manifest.ts), because the env var and the
 * artifact esbuild actually names after package.json were two independent
 * answers to one question and were never equal - a loader told to fetch
 * v1.0.0 requested an artifact that was never published.
 *
 * The constant had no importers. It is removed rather than left in place so
 * nobody ships a rollback by setting a value that does nothing.
 */

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
