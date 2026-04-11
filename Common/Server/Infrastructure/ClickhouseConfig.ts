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

export const testDataSourceOptions: ClickHouseClientConfigOptions =
  dataSourceOptions;
