import PostgresDatabase from '../../Infrastructure/PostgresDatabase';

export default class DatabaseConnect {
    public static async connect() {
        await PostgresDatabase.connect();
    }

    public static async drop() {
        // do ntohing
    }
}