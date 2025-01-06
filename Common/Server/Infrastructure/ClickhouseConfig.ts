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
