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

// Prometheus remote write (1.0 and 2.0): a Prometheus server, Grafana Alloy, an agent.
export const PROMETHEUS_REMOTE_WRITE_PATH: string = "/prometheus/api/v1/write";

// Loki's push API, at Loki's own path: Promtail, Grafana Alloy, Fluent Bit, Vector.
export const LOKI_PUSH_PATH: string = "/loki/api/v1/push";

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
