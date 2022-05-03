import PostgresDatabase, { DataSourceOptions} from '../../Infrastructure/PostgresDatabase';
import { createDatabase, dropDatabase } from 'typeorm-extension';

export default class DatabaseConnect {
    public static async createAndConnect() {
        await this.createDatabase();
        await this.connectDatabase();
    }

    public static async disconnectAndDropDatabase() {
        await this.disconnectDatabase();
        await this.dropDatabase();
    }

    public static async createDatabase() {
        await createDatabase({
            options: DataSourceOptions,
            ifNotExist: true
        });
    }
    public static async connectDatabase() {
        await PostgresDatabase.connect();
    }

    public static async disconnectDatabase() {
        await PostgresDatabase.disconnect();
    }

    public static async dropDatabase() {
        await dropDatabase({
            options: DataSourceOptions,
            ifExist: true
        });
    }
}