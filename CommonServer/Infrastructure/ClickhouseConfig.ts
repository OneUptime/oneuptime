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
} from '../EnvironmentConfig';
import { NodeClickHouseClientConfigOptions } from '@clickhouse/client/dist/client';

export type ClickHouseClientConfigOptions = NodeClickHouseClientConfigOptions;

const hostProtocol: string = ClickHouseIsHostHttps ? 'https' : 'http';

const options: ClickHouseClientConfigOptions = {
    host: `${hostProtocol}://${ClickhouseHost.toString()}:${ClickhousePort.toNumber()}`,
    username: ClickhouseUsername,
    password: ClickhousePassword,
    database: ClickhouseDatabase,
    application: 'oneuptime',
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
