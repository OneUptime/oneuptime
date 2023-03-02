import { DataSource, DataSourceOptions } from 'typeorm';
import logger from '../Utils/Logger';
import { dataSourceOptions, testDataSourceOptions } from './PostgresConfig';
import Sleep from "Common/Types/Sleep"

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

        let retry = 0;

        try {

            const connectToDatabase: Function = async (): Promise<DataSource> => {

                try {
                    const PostgresDataSource: DataSource = new DataSource(
                        dataSourceOptions
                    );
                    const dataSource: DataSource =
                        await PostgresDataSource.initialize();
                    logger.info('Postgres Database Connected');
                    this.dataSource = dataSource;
                    return dataSource;
                } catch (err) {
                    if(retry<3){
                        logger.info("Cannot connect to Postgres. Retrying again in 5 seconds");
                        // sleep for 5 seconds. 

                        await Sleep.sleep(5000);

                        retry++; 
                        return await connectToDatabase();
                    }else{
                        throw err; 
                    }
                }
            }

            return await connectToDatabase();

        } catch (err) {

            logger.error('Postgres Database Connection Failed');
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
