import { DataSource } from 'typeorm';
import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
    Env,
} from '../Config';


import Entities from 'Common/Models/Index';
import AppEnvironment from 'Common/Types/AppEnvironment';
import DatabaseType from 'Common/Types/DatabaseType';

export const DataSourceOptions = {
    type: DatabaseType.Postgres,
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName,
    entities: Entities,
    synchronize: Env === AppEnvironment.Test || Env === AppEnvironment.Development
};

const PostgresDataSource: DataSource = new DataSource(DataSourceOptions);

export default class Database {
    private static dataSource: DataSource | null;

    public static getDataSource(): DataSource | null {
        return this.dataSource;
    }

    public static async connect(): Promise<DataSource> {
        if (!this.dataSource) {
            await this.getDataSource();
        }
        this.dataSource = await PostgresDataSource.initialize();
        return this.dataSource;
    }

    public static async disconnect(): Promise<void> {
        if (!this.getDataSource()) {
            await this.getDataSource()?.destroy();
            this.dataSource = null;
        }
    }
}
