import PostgresDatabase, {
    DataSourceOptions,
} from '../../Infrastructure/PostgresDatabase';
import { createDatabase, dropDatabase } from 'typeorm-extension';
import { DataSource } from 'typeorm';

export default class DatabaseConnect {
    public static async createAndConnect(): Promise<void> {
        await this.createDatabase();
        await this.connectDatabase();
    }

    public static async disconnectAndDropDatabase(): Promise<void> {
        await this.disconnectDatabase();
        await this.dropDatabase();
    }

    public static async createDatabase(): Promise<void> {
        await createDatabase({
            options: DataSourceOptions,
            ifNotExist: true,
        });
    }
    public static async connectDatabase(): Promise<void> {
            const connection: DataSource = await PostgresDatabase.connect();
            await connection.synchronize();
    }

    public static async disconnectDatabase(): Promise<void> {
        await PostgresDatabase.disconnect();
    }

    public static async dropDatabase(): Promise<void> {
        await dropDatabase({
            options: DataSourceOptions,
            ifExist: true,
        });
    }
}
