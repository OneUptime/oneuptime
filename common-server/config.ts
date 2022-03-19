export const databaseUrl: string =
    process.env.MONGO_URL || 'mongodb://localhost:27017/oneuptimedb';
export const databaseName: string = process.env.DB_NAME || 'oneuptimedb';
