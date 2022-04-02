export const databaseUrl: string =
    process.env['MONGO_URL'] || 'mongodb://localhost:27017/oneuptimedb';
export const databaseName: string = process.env['DB_NAME'] || 'oneuptimedb';
export const isMongoReplicaSet: boolean = !!process.env['IS_MONGO_REPLICA_SET'];
export const tokenSecret: string = process.env['TOKEN_SECRET'] || '';
