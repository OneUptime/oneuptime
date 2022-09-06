import { DataSource, DataSourceOptions } from 'typeorm';
import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
    Env,
} from '../Config';

import Entities from 'Model/Models/Index';
import AppEnvironment from 'Common/Types/AppEnvironment';
import DatabaseType from 'Common/Types/DatabaseType';
import Faker from 'Common/Tests/TestingUtils/Faker';
import logger from '../Utils/Logger';

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
            logging: 'all',
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
        try {
            const PostgresDataSource: DataSource = new DataSource(
                dataSourceOptions
            );
            const dataSource: DataSource =
                await PostgresDataSource.initialize();
            logger.info('Posgres Database Connected');
            this.dataSource = dataSource;
            return dataSource;
        } catch (err) {
            logger.error('Posgres Database Connection Failed');
            logger.error(err);
            throw err;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.dataSource) {
            await this.dataSource.destroy();
            this.dataSource = null;
        }
    }
}

export const PostgresAppInstance: Database = new Database();
