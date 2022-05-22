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
    private dataSource!: DataSource | null;

    public getDatasourceOptions(): DataSourceOptions {
        return {
            type: DatabaseType.Postgres,
            host: DatabaseHost.toString(),
            port: DatabasePort.toNumber(),
            username: DatabaseUsername,
            password: DatabasePassword,
            database: DatabaseName,
            entities: Entities,
            synchronize:
                Env === AppEnvironment.Test ||
                Env === AppEnvironment.Development,
        };
    }

    public getTestDatasourceOptions(): DataSourceOptions {
        return {
            type: DatabaseType.Postgres,
            host: DatabaseHost.toString(),
            port: DatabasePort.toNumber(),
            username: DatabaseUsername,
            password: DatabasePassword,
            database: DatabaseName + Faker.random16Numbers(),
            entities: Entities,
            synchronize:
                Env === AppEnvironment.Test ||
                Env === AppEnvironment.Development,
        };
    }

    public getDataSource(): DataSource | null {
        return this.dataSource;
    }

    public isConnected(): boolean {
        return Boolean(this.dataSource);
    }

    public async connect(
        dataSourceOptions: DataSourceOptions
    ): Promise<DataSource> {
        const PostgresDataSource: DataSource = new DataSource(
            dataSourceOptions
        );
        const dataSource: DataSource = await PostgresDataSource.initialize();
        this.dataSource = dataSource;
        return dataSource;
    }

    public async disconnect(): Promise<void> {
        if (this.dataSource) {
            await this.dataSource.destroy();
            this.dataSource = null;
        }
    }
}

export const PostgresAppInstance: Database = new Database();
