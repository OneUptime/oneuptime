import MongoDB from 'mongodb';
import { DatabaseUrl, DatabaseName } from '../Config';
import Grid from 'gridfs-stream';

export default class Database {
    private static databaseClient: MongoDB.MongoClient;
    private static databaseConnected: boolean = false;
    private static fileClient: MongoDB.Collection;

    public static getClient(): MongoDB.MongoClient {
        this.databaseClient = new MongoDB.MongoClient(DatabaseUrl);
        return this.databaseClient;
    }

    public static async getFileClient(): Promise<MongoDB.Collection> {
        if (this.fileClient) {
            return this.fileClient;
        }

        const database: $TSFixMe = await this.getDatabase();
        const mongoClient: $TSFixMe = await this.getClient();
        this.fileClient = await Grid(database, mongoClient).collection(
            'uploads'
        );

        return this.fileClient;
    }

    public static async connect(): Promise<MongoDB.MongoClient> {
        if (!this.databaseClient) {
            await this.getClient();
        }
        await this.databaseClient.connect();
        return this.databaseClient;
    }

    public static async getDatabase(): Promise<MongoDB.Db> {
        if (!this.databaseConnected) {
            await this.connect();
            this.databaseConnected = true;
        }
        return this.databaseClient.db(DatabaseName);
    }
}
