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
import Hostname from "../../Types/API/Hostname";

export type ClickHouseClientConfigOptions = NodeClickHouseClientConfigOptions;

const hostProtocol: string = ClickHouseIsHostHttps ? "https" : "http";

const clickhouseHost: Hostname = ClickhouseHost || new Hostname("clickhouse");
const clickhousePort: string = (ClickhousePort || 8123).toString();

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
 */
export const migrationDataSourceOptions: ClickHouseClientConfigOptions = {
  ...options,
  request_timeout: 30 * 60 * 1000, // 30 minutes
};

export const testDataSourceOptions: ClickHouseClientConfigOptions =
  dataSourceOptions;
