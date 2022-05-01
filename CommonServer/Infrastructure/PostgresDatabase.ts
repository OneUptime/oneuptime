import { DataSource } from 'typeorm';
import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
} from '../Config';


import Entities from 'Common/Models/Index';

const PostgresDataSource: DataSource = new DataSource({
    type: 'postgres',
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName,
    entities: Entities
});

export default class Database {
    private static dataSource: DataSource;

    public static getDataSource(): DataSource {
        return this.dataSource;
    }

    public static async connect(): Promise<DataSource> {
        if (!this.dataSource) {
            await this.getDataSource();
        }
        this.dataSource = await PostgresDataSource.initialize();
        return this.dataSource;
    }
}
