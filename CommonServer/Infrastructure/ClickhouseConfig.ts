import {
    ClickhouseDatabase,
    ClickhouseHost,
    ClickhousePassword,
    ClickhousePort,
    ClickhouseUsername,
} from '../EnvironmentConfig';
import { NodeClickHouseClientConfigOptions } from '@clickhouse/client/dist/client';

export type ClickHouseClientConfigOptions = NodeClickHouseClientConfigOptions;

export const dataSourceOptions: ClickHouseClientConfigOptions = {
    host: `http://${ClickhouseHost.toString()}:${ClickhousePort.toNumber()}`,
    username: ClickhouseUsername,
    password: ClickhousePassword,
    database: ClickhouseDatabase,
    application: 'oneuptime',
};

export const testDataSourceOptions: ClickHouseClientConfigOptions =
    dataSourceOptions;
