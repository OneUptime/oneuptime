import logger from '../Utils/Logger';
import {
    dataSourceOptions,
    testDataSourceOptions,
    ClickHouseClientConfigOptions,
} from './ClickhouseConfig';
import Sleep from 'Common/Types/Sleep';
import { ClickHouseClient, createClient } from '@clickhouse/client';
import Stream from 'stream';

export type ClickhouseClient = ClickHouseClient<Stream.Readable>;

export default class ClickhouseDatabase {
    private dataSource!: ClickhouseClient | null;

    public getDatasourceOptions(): ClickHouseClientConfigOptions {
        return dataSourceOptions;
    }

    public getTestDatasourceOptions(): ClickHouseClientConfigOptions {
        return testDataSourceOptions;
    }

    public getDataSource(): ClickhouseClient | null {
        return this.dataSource;
    }

    public isConnected(): boolean {
        return Boolean(this.dataSource);
    }

    public async connect(
        dataSourceOptions: ClickHouseClientConfigOptions
    ): Promise<ClickhouseClient> {
        let retry: number = 0;

        try {
            const connectToDatabase: Function =
                async (): Promise<ClickhouseClient> => {
                    try {
                        const clickhouseClient: ClickhouseClient =
                            createClient(dataSourceOptions);
                        this.dataSource = clickhouseClient;
                        return clickhouseClient;
                    } catch (err) {
                        if (retry < 3) {
                            logger.info(
                                'Cannot connect to Clickhouse. Retrying again in 5 seconds'
                            );
                            // sleep for 5 seconds.

                            await Sleep.sleep(5000);

                            retry++;
                            return await connectToDatabase();
                        }
                        throw err;
                    }
                };

            return await connectToDatabase();
        } catch (err) {
            logger.error('Clickhouse Database Connection Failed');
            logger.error(err);
            throw err;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.dataSource) {
            await this.dataSource.close();
            this.dataSource = null;
        }
    }
}

export const ClickhouseAppInstance: ClickhouseDatabase =
    new ClickhouseDatabase();
