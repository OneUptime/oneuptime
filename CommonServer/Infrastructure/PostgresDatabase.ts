import { DataSource } from 'typeorm';
import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
} from '../Config';

export const PostgresDataSource: DataSource = new DataSource({
    type: 'postgres',
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName,
});

export default class Database {
    private static dataSource: DataSource;

    public static getClient(): DataSource {
        return this.dataSource;
    }

    public static async connect(): Promise<DataSource> {
        if (!this.dataSource) {
            await this.getClient();
        }
        this.dataSource = await PostgresDataSource.initialize();
        return this.dataSource;
    }
}
