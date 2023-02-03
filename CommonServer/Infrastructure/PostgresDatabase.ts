import type { DataSourceOptions } from 'typeorm';
import { DataSource } from 'typeorm';
import logger from '../Utils/Logger';
import { dataSourceOptions, testDataSourceOptions } from './PostgresConfig';

export default class Database {
    private dataSource!: DataSource | null;

    public getDatasourceOptions(): DataSourceOptions {
        return dataSourceOptions;
    }

    public getTestDatasourceOptions(): DataSourceOptions {
        return testDataSourceOptions;
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
