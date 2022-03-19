import MongoDB from 'mongodb';
import { databaseUrl, databaseName } from '../config';

export default class Database {
    static databaseClient: MongoDB.MongoClient;
    static databaseConnected: boolean = false;

    static getClient(): MongoDB.MongoClient {
        this.databaseClient = new MongoDB.MongoClient(databaseUrl);

        return this.databaseClient;
    }

    static async connect() {
        if (!this.databaseClient) {
            await this.getClient();
        }
        await this.databaseClient.connect();
    }

    static async getDatabase(): Promise<MongoDB.Db> {
        if (!this.databaseConnected) {
            await this.connect();
            this.databaseConnected = true;
        }
        return this.databaseClient.db(databaseName);
    }
}
