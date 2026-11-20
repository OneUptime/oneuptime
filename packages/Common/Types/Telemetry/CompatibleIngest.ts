/*
 * THE COMPATIBLE INGEST ENDPOINTS: OTHER TOOLS' PROTOCOLS, ACCEPTED AS THEY
 * ARE.
 *
 * A team moving to OneUptime should not have to re-instrument anything to
 * try it. These endpoints accept what the agents and SDKs they already run
 * send - Prometheus remote write, Loki's push API, Splunk's HTTP Event
 * Collector, the Datadog Agent and Datadog's HTTP intake, and Sentry SDKs -
 * so moving is a change of URL and key. What arrives is turned into OTLP
 * and stored like any OpenTelemetry data.
 *
 * Each path is given without the /telemetry prefix: the App serves every
 * telemetry route under both "/telemetry" and "/" (FeatureSet/Telemetry),
 * and the shipped ingress sends /telemetry to the App on every install.
 *
 * Shared by the server (the routes, and StartServer, which leaves these
 * paths' bodies to them), the dashboard's setup guide and the docs tests.
 * React-free and Node-free.
 */

export const COMPATIBLE_INGEST_URL_PREFIX: string = "/telemetry";

/*
 * The most values a compatible endpoint's JSON body may parse into - every
 * object, array, string (a key too), number, true, false and null -
 * counted before it is parsed. These bodies are parsed on the App's request
 * thread, and "[]," is three bytes but an array of forty on the heap: 32 MiB
 * of empty arrays would take half a gigabyte and seconds of that thread.
 * Every client's own batches are far below it: a 5 MB Datadog log payload,
 * or a 2 MiB batch from the OpenTelemetry Collector's Splunk HEC exporter,
 * is a few hundred thousand.
 */
export const COMPATIBLE_JSON_MAX_VALUES: number = 1000000;

// Prometheus remote write (1.0 and 2.0): a Prometheus server, Grafana Alloy, an agent.
export const PROMETHEUS_REMOTE_WRITE_PATH: string = "/prometheus/api/v1/write";

/*
 * The most a remote write request may be, as sent and once its snappy
 * compression is undone. Prometheus and Alloy send 2,000 samples a request
 * by default, well under a megabyte; VictoriaMetrics' own receiver holds a
 * request to the same 32 MiB.
 */
export const PROMETHEUS_REMOTE_WRITE_MAX_BYTES: number = 32 * 1024 * 1024;

/*
 * The most series, labels, samples, exemplars, histograms and histogram
 * buckets one remote write request may hold, counted before it is decoded:
 * each one is an object in memory once it is, so a small body packed with
 * empty series cannot take gigabytes. 2,000 samples of series with a dozen
 * labels are about 28,000.
 */
export const PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS: number = 500000;

// Loki's push API, at Loki's own path: Promtail, Grafana Alloy, Fluent Bit, Vector.
export const LOKI_PUSH_PATH: string = "/loki/api/v1/push";

/*
 * The most a Loki push may be, as sent and once decompressed (its snappy
 * or gzip undone). Promtail and Alloy send batches of 1 MiB by default
 * (batch_size), and Loki itself refuses a push over its 6 MB ingestion
 * burst; remote write is held to the same 32 MiB.
 */
export const LOKI_PUSH_MAX_BYTES: number = 32 * 1024 * 1024;

/*
 * The most streams, entries, labels and structured metadata one Loki push
 * may hold, a stream's labels counted once for each of its entries: every
 * entry becomes a log record that carries them all as attributes. Counted
 * before a protobuf push is decoded, and again as the push is read, before
 * anything is translated, so a small body cannot become millions of
 * objects. A 1 MiB batch of 100-byte lines from streams of five labels is
 * about 60,000.
 */
export const LOKI_PUSH_MAX_ELEMENTS: number = 500000;

/*
 * Splunk's HTTP Event Collector, at Splunk's own paths. Some clients
 * (Splunk's Docker logging driver, Fluent Bit's splunk output) post to
 * these paths at the root of the host they are given, so the shipped
 * ingress sends /services/collector to the App too.
 */
export const SPLUNK_HEC_BASE_PATH: string = "/services/collector";
export const SPLUNK_HEC_EVENT_PATHS: ReadonlyArray<string> = [
  "/services/collector",
  "/services/collector/event",
  "/services/collector/event/1.0",
];
export const SPLUNK_HEC_RAW_PATHS: ReadonlyArray<string> = [
  "/services/collector/raw",
];
export const SPLUNK_HEC_HEALTH_PATHS: ReadonlyArray<string> = [
  "/services/collector/health",
];

/*
 * Datadog's intake, under /datadog: the Datadog Agent's `dd_url` is
 * <host>/telemetry/datadog, and the routes below it are Datadog's own.
 */
export const DATADOG_BASE_PATH: string = "/datadog";
export const DATADOG_LOGS_PATH: string = "/api/v2/logs";
export const DATADOG_SERIES_V1_PATH: string = "/api/v1/series";
export const DATADOG_SERIES_V2_PATH: string = "/api/v2/series";
export const DATADOG_SKETCHES_PATH: string = "/api/beta/sketches";
export const DATADOG_CHECK_RUN_PATH: string = "/api/v1/check_run";
export const DATADOG_VALIDATE_PATH: string = "/api/v1/validate";
/*
 * What the Agent reports about itself and its host (host tags, inventory).
 * Not telemetry: accepted so the Agent reports no error, and not kept.
 */
export const DATADOG_METADATA_PATHS: ReadonlyArray<string> = [
  "/intake",
  "/api/v1/metadata",
];

/*
 * The most series, points, resources, tags, sketches and sketch summaries
 * one Datadog Agent protobuf payload (/api/v2/series, /api/beta/sketches)
 * may hold, counted before it is decoded: each is an object once it is.
 * The Agent splits its payloads at 10,000 points and 5 MB decompressed,
 * about 300,000 of them at most.
 */
export const DATADOG_PROTOBUF_MAX_ELEMENTS: number = 500000;

// Every intake path, as served under /datadog.
export const DATADOG_PATHS: ReadonlyArray<string> = [
  DATADOG_LOGS_PATH,
  DATADOG_SERIES_V1_PATH,
  DATADOG_SERIES_V2_PATH,
  DATADOG_SKETCHES_PATH,
  DATADOG_CHECK_RUN_PATH,
  DATADOG_VALIDATE_PATH,
  ...DATADOG_METADATA_PATHS,
];

/*
 * The Datadog Agent posts logs to /api/v2/logs on the host it is given
 * (logs_config.logs_dd_url is a host and port, never a path), so that one
 * route is served at the root too - only to a request that carries a
 * DD-API-KEY header, so nothing else under /api is ever answered by it.
 * Everything else the Agent sends goes to dd_url, which takes a path.
 */
export const DATADOG_ROOT_PATHS: ReadonlyArray<string> = [DATADOG_LOGS_PATH];

/*
 * Sentry's ingest API under /sentry: a DSN of
 * https://<key>@<host>/telemetry/sentry/<number> makes an SDK post to
 * <host>/telemetry/sentry/api/<number>/envelope/. The number is any number
 * (SDKs refuse a DSN without one); it is not read.
 */
export const SENTRY_BASE_PATH: string = "/sentry";
export const SENTRY_DSN_PROJECT_NUMBER: string = "1";

// /sentry/api/<n>/envelope or /store, without /telemetry or a trailing slash.
const SENTRY_INGEST_PATH: RegExp = /^\/sentry\/api\/[^/]+\/(envelope|store)$/;

/*
 * Whether StartServer's body parsers must leave a request's body to the
 * compatible endpoint it is for: matched as the routers match, in any
 * case, with or without the /telemetry prefix and a trailing slash.
 */
export function isCompatibleIngestPath(path: string): boolean {
  let normalized: string = (path || "").toLowerCase();

  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.startsWith(`${COMPATIBLE_INGEST_URL_PREFIX}/`)) {
    normalized = normalized.slice(COMPATIBLE_INGEST_URL_PREFIX.length);
  }

  if (
    normalized === PROMETHEUS_REMOTE_WRITE_PATH ||
    normalized === LOKI_PUSH_PATH
  ) {
    return true;
  }

  if (
    normalized === SPLUNK_HEC_BASE_PATH ||
    normalized.startsWith(`${SPLUNK_HEC_BASE_PATH}/`)
  ) {
    return true;
  }

  if (
    normalized.startsWith(`${DATADOG_BASE_PATH}/`) &&
    DATADOG_PATHS.includes(normalized.slice(DATADOG_BASE_PATH.length))
  ) {
    return true;
  }

  if (DATADOG_ROOT_PATHS.includes(normalized)) {
    return true;
  }

  return SENTRY_INGEST_PATH.test(normalized);
}
