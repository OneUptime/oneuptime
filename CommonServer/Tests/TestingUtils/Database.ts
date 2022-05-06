import PostgresDatabase from '../../Infrastructure/PostgresDatabase';
import { createDatabase, dropDatabase } from 'typeorm-extension';
import { DataSource, DataSourceOptions } from 'typeorm';

export default class DatabaseConnect {
    public static async createAndConnect(): Promise<DataSourceOptions> {
        const dataSourceOptions: DataSourceOptions = await this.createDatabase();
        await this.connectDatabase(dataSourceOptions);
        return dataSourceOptions;
    }

    public static async disconnectAndDropDatabase(dataSourceOptions: DataSourceOptions): Promise<void> {
        await this.disconnectDatabase();
        await this.dropDatabase(dataSourceOptions);
    }

    public static async createDatabase(): Promise<DataSourceOptions> {
        const dataSourceOptions: DataSourceOptions = PostgresDatabase.getTestDatasourceOptions();
        await createDatabase({
            options: PostgresDatabase.getTestDatasourceOptions(),
            ifNotExist: true,
        });

        return dataSourceOptions;
    }
    public static async connectDatabase(dataSourceOptions: DataSourceOptions): Promise<void> {
        const connection: DataSource = await PostgresDatabase.connect(dataSourceOptions);
        await connection.synchronize();
    }

    public static async disconnectDatabase(): Promise<void> {
        await PostgresDatabase.disconnect();
    }

    public static async dropDatabase(dataSourceOptions: DataSourceOptions): Promise<void> {
        await dropDatabase({
            options: dataSourceOptions,
            ifExist: true,
        });
    }
}
