import MongoDB from 'mongodb';
import { databaseUrl, databaseName } from '../Config';
import Grid from 'gridfs-stream';

export default class Database {
    private static databaseClient: MongoDB.MongoClient;
    private static databaseConnected: boolean = false;
    private static fileClient: MongoDB.Collection;

    public static getClient(): MongoDB.MongoClient {
        this.databaseClient = new MongoDB.MongoClient(databaseUrl);
        return this.databaseClient;
    }

    public static async getFileClient(): Promise<MongoDB.Collection> {
        if (this.fileClient) {
            return this.fileClient;
        }

        const database = await this.getDatabase();
        const mongoClient = await this.getClient();
        this.fileClient = await Grid(database, mongoClient).collection(
            'uploads'
        );

        return this.fileClient;
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
