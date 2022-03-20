import MongoDB from 'mongodb';
import { databaseUrl, databaseName } from '../config';

export default class Database {
    private static databaseClient: MongoDB.MongoClient;
    private static databaseConnected: boolean = false;

    public static getClient(): MongoDB.MongoClient {
        this.databaseClient = new MongoDB.MongoClient(databaseUrl);
        return this.databaseClient;
    }

    public static async connect() {
        if (!this.databaseClient) {
            await this.getClient();
        }
        await this.databaseClient.connect();
    }

    public static async getDatabase(): Promise<MongoDB.Db> {
        if (!this.databaseConnected) {
            await this.connect();
            this.databaseConnected = true;
        }
        return this.databaseClient.db(databaseName);
    }
}
