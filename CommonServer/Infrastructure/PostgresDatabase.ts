import { DataSource, DataSourceOptions } from 'typeorm';
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
import Faker from 'Common/Tests/TestingUtils/Faker';

export default class Database {
    private static dataSource: DataSource | null;

    public static getDataSource(): DataSource | null {
        return this.dataSource;
    }

    public static getDatasourceOptions(): DataSourceOptions{
        return {
            type: DatabaseType.Postgres,
            host: DatabaseHost.toString(),
            port: DatabasePort.toNumber(),
            username: DatabaseUsername,
            password: DatabasePassword,
            database: DatabaseName,
            entities: Entities,
            synchronize:
                Env === AppEnvironment.Test || Env === AppEnvironment.Development,
        };
    }

    public static getTestDatasourceOptions(): DataSourceOptions{
        return {
            type: DatabaseType.Postgres,
            host: DatabaseHost.toString(),
            port: DatabasePort.toNumber(),
            username: DatabaseUsername,
            password: DatabasePassword,
            database: DatabaseName+Faker.generateName(),
            entities: Entities,
            synchronize:
                Env === AppEnvironment.Test || Env === AppEnvironment.Development,
        };
    }

    public static async connect(dataSourceOptions: DataSourceOptions): Promise<DataSource> {
        const PostgresDataSource: DataSource = new DataSource(dataSourceOptions);
        this.dataSource = PostgresDataSource;
        this.dataSource = await PostgresDataSource.initialize();
        return this.dataSource;
    }

    public static async disconnect(): Promise<void> {
        if (this.getDataSource()) {
            await this.getDataSource()?.destroy();
            this.dataSource = null;
        }
    }
}
