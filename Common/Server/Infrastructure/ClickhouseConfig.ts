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

export const testDataSourceOptions: ClickHouseClientConfigOptions =
  dataSourceOptions;
