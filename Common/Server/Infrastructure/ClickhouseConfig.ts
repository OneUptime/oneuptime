import { NodeClickHouseClientConfigOptions } from "@clickhouse/client/dist/config";
import {
  ClickHouseIsHostHttps,
  ClickhouseDatabase,
  ClickhouseHost,
  ClickhousePassword,
  ClickhousePort,
  ClickhouseTlsCa,
  ClickhouseTlsCert,
  ClickhouseTlsKey,
  ClickhouseUsername,
  MaxClickhouseConnections,
  MaxClickhouseIngestConnections,
  ShouldClickhouseSslEnable,
} from "../EnvironmentConfig";
import { getDistributedDdlTaskTimeoutSeconds } from "../Utils/AnalyticsDatabase/ClusterConfig";
import Hostname from "../../Types/API/Hostname";

export type ClickHouseClientConfigOptions = NodeClickHouseClientConfigOptions;

const hostProtocol: string = ClickHouseIsHostHttps ? "https" : "http";

const clickhouseHost: Hostname = ClickhouseHost || new Hostname("clickhouse");
const clickhousePort: string = (ClickhousePort || 8123).toString();

/*
 * How long the client keeps an idle pooled HTTP socket alive before
 * destroying it (keep_alive.idle_socket_ttl). @clickhouse/client enables
 * keep-alive by default but expires idle sockets after only 2500ms, while
 * the telemetry fan-in writer's flush window (TELEMETRY_FANIN_MAX_WAIT_MS,
 * see TelemetryFanInWriter.ts) defaults to 5000ms — so under sub-saturation
 * ingest load every pooled socket was destroyed between flushes and every
 * flush paid TCP (+TLS) connection setup again. The default here is bounded
 * on both sides:
 *
 *   - ABOVE the 5000ms fan-in flush window, so the socket a flush opened is
 *     still alive when the next flush fires and gets reused instead of
 *     being re-established;
 *   - BELOW the ClickHouse server's keep_alive_timeout of 10s (the bundled
 *     Clickhouse/config.xml pins <keep_alive_timeout>10</keep_alive_timeout>,
 *     which is also the server default since 23.11), so the CLIENT always
 *     retires an idle socket before the SERVER does. Operators who lower
 *     the server's keep_alive_timeout below this TTL must lower
 *     CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS along with it (keeping it a
 *     fair bit under the server value) — otherwise the client reuses
 *     sockets the server has already closed and requests fail with
 *     ECONNRESET.
 *
 * The value must be a positive number of milliseconds; unset, non-numeric,
 * zero and negative values all fall back to the default. Zero is rejected
 * deliberately: the client treats 0 as "disable idle-socket reaping
 * entirely", which reintroduces the server-closes-first ECONNRESET failure
 * mode this TTL exists to prevent.
 */
const DEFAULT_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: number = 8000;

const keepAliveIdleSocketTtlRawValue: string = (
  process.env["CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS"] || ""
).trim();

const keepAliveIdleSocketTtlParsedValue: number = parseInt(
  keepAliveIdleSocketTtlRawValue,
  10,
);

const keepAliveIdleSocketTtlInMs: number =
  Number.isFinite(keepAliveIdleSocketTtlParsedValue) &&
  keepAliveIdleSocketTtlParsedValue > 0
    ? keepAliveIdleSocketTtlParsedValue
    : DEFAULT_KEEP_ALIVE_IDLE_SOCKET_TTL_MS;

const options: ClickHouseClientConfigOptions = {
  url: `${hostProtocol}://${clickhouseHost.toString()}:${clickhousePort}`,
  username: ClickhouseUsername,
  password: ClickhousePassword,
  database: ClickhouseDatabase,
  application: "oneuptime",
  /*
   * The default @clickhouse/client request_timeout is 30s which is too
   * short for aggregation queries over wide time ranges on large span /
   * log tables. Cap it just under nginx's 60s proxy_read_timeout so that
   * (a) a slow query still has headroom and (b) nginx never hits its
   * upstream timeout first. Per-query SETTINGS max_execution_time on
   * aggregation statements provides the hard server-side cap.
   *
   * NOTE: the client enforces this as a socket IDLE timer
   * (socket.setTimeout -> request.destroy()), not a wall-clock cap: it
   * fires only after 58s with NO bytes received. An HTTP INSERT...SELECT
   * returns zero bytes until it completes, so any such statement that
   * needs longer MUST pass per-call clickhouse_settings
   * send_progress_in_http_headers (+ http_headers_progress_interval_ms)
   * — the streamed X-ClickHouse-Progress header lines keep the socket
   * non-idle (see AnalyticsDatabaseService.ClickhouseExecuteOptions and
   * the telemetry V3 backfill engine, which do exactly that). Verified
   * empirically on dev: an 80s INSERT...SELECT is destroyed at exactly
   * 58s without progress headers and completes with them.
   */
  request_timeout: 58_000,
  /*
   * @clickhouse/client defaults max_open_connections to 10. Sized for the
   * query pool (dashboard reads, DDL); ingest writes use a separate pool
   * (see ingestDataSourceOptions) so a burst of inserts cannot starve
   * user-facing queries of HTTP sockets.
   */
  max_open_connections: MaxClickhouseConnections,
  /*
   * Enable HTTP gzip compression in both directions. `request: true`
   * gzips the client request body (large telemetry insert batches) before
   * it goes over the wire; `response: true` asks ClickHouse to gzip query
   * results (the wide log / span / metric JSON result sets dashboards
   * read back). Both cut network bytes several-fold for the JSON payloads
   * OneUptime exchanges, at a small CPU cost that the transfer savings
   * outweigh. Response compression sends `enable_http_compression=1` per
   * request, which requires a non-readonly user — the OneUptime ClickHouse
   * user runs DDL and inserts, so that condition is satisfied.
   */
  compression: {
    request: true,
    response: true,
  },
  /*
   * Reuse pooled sockets across fan-in flush windows — see the note on
   * keepAliveIdleSocketTtlInMs above for both bounds on the TTL and the
   * operator warning about the server's keep_alive_timeout. `enabled: true`
   * restates the client default explicitly so the pairing with
   * idle_socket_ttl is visible here rather than implied. This lives on the
   * shared `options` object, so every pool derived from it (query, ingest,
   * migration, test) gets the same keep-alive behavior.
   */
  keep_alive: {
    enabled: true,
    idle_socket_ttl: keepAliveIdleSocketTtlInMs,
  },
};

if (ShouldClickhouseSslEnable && ClickhouseTlsCa) {
  options.tls = {
    ca_cert: Buffer.from(ClickhouseTlsCa),
  };
}

if (
  ShouldClickhouseSslEnable &&
  ClickhouseTlsCa &&
  ClickhouseTlsCert &&
  ClickhouseTlsKey
) {
  options.tls = {
    ca_cert: Buffer.from(ClickhouseTlsCa),
    cert: Buffer.from(ClickhouseTlsCert),
    key: Buffer.from(ClickhouseTlsKey),
  };
}

export const dataSourceOptions: ClickHouseClientConfigOptions = options;

export const ingestDataSourceOptions: ClickHouseClientConfigOptions = {
  ...options,
  max_open_connections: MaxClickhouseIngestConnections,
};

/*
 * Dedicated pool for schema sync + data migrations. The 58s request_timeout
 * above is a socket *idle* timer (see the note on request_timeout) sized for
 * dashboard reads sitting behind nginx's 60s proxy_read_timeout. Migrations
 * do NOT go through nginx (the app connects straight to clickhouse:8123), and
 * a single migration statement — an ON CLUSTER DDL, an MV / projection
 * rebuild, or a type/codec-rewrite MODIFY COLUMN on a multi-billion-row
 * telemetry table — can legitimately stream zero bytes for many minutes,
 * which the 58s idle timer would destroy mid-flight ("Timeout error.") and
 * crash the boot process. Give migrations a much higher idle ceiling. It is
 * finite (not 0) on purpose: a genuinely dead connection / network black hole
 * must still fail eventually rather than hang forever. Long statements should
 * additionally carry send_progress_in_http_headers (see MigrationExecuteOptions
 * in AnalyticsDatabaseService) so the socket stays non-idle, and a server-side
 * SETTINGS max_execution_time so ClickHouse remains the authoritative cap.
 *
 * The ON CLUSTER confirmation wait (distributed_ddl_task_timeout) streams zero
 * bytes while pending, so this idle ceiling is the effective upper bound on any
 * DDL confirmation wait. When CLICKHOUSE_DISTRIBUTED_DDL_TASK_TIMEOUT_SECONDS
 * is raised past the 30-minute floor, scale the ceiling with it (plus slack)
 * so the longer wait isn't killed client-side. A negative (infinite) DDL
 * timeout is still bounded by the 30-minute floor — the client must not hang
 * forever on a dead socket.
 */
const migrationRequestTimeoutInMs: number = Math.max(
  30 * 60 * 1000, // 30-minute floor
  (getDistributedDdlTaskTimeoutSeconds() + 120) * 1000,
);

export const migrationDataSourceOptions: ClickHouseClientConfigOptions = {
  ...options,
  request_timeout: migrationRequestTimeoutInMs,
};

export const testDataSourceOptions: ClickHouseClientConfigOptions =
  dataSourceOptions;
