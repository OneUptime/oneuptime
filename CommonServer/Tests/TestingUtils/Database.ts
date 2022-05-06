import PostgresDatabase from '../../Infrastructure/PostgresDatabase';
import { createDatabase, dropDatabase } from 'typeorm-extension';
import { DataSource, DataSourceOptions } from 'typeorm';

export default class DatabaseConnect {
    private database!: PostgresDatabase;
    private dataSourceOptions!: DataSourceOptions;

    constructor() {
        this.database = new PostgresDatabase();
    }

    public getDatabase(): PostgresDatabase {
        return this.database;
    }

    public async createAndConnect(): Promise<DataSource> {
        const dataSourceOptions: DataSourceOptions = await this.createDatabase();
        return await this.connectDatabase(dataSourceOptions);
    }

    public async disconnectAndDropDatabase(): Promise<void> {
        await this.disconnectDatabase();
        await this.dropDatabase();
    }

    public async createDatabase(): Promise<DataSourceOptions> {
        const dataSourceOptions: DataSourceOptions = this.database.getTestDatasourceOptions();
        this.dataSourceOptions = dataSourceOptions;
        await createDatabase({
            options: this.database.getTestDatasourceOptions(),
            ifNotExist: true,
        });

        return dataSourceOptions;
    }
    public async connectDatabase(dataSourceOptions: DataSourceOptions): Promise<DataSource> {
        const connection: DataSource = await this.database.connect(dataSourceOptions);
        await connection.synchronize();
        return connection;
    }

    public async disconnectDatabase(): Promise<void> {
        await this.database.disconnect();
    }

    public async dropDatabase(): Promise<void> {
        await dropDatabase({
            options: this.dataSourceOptions,
            ifExist: true,
        });
    }
}
