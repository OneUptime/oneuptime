import packageJson from '../package.json';

export const clusterKey = process.env.CLUSTER_KEY;
export const fetchResourcesVersion = packageJson.version;
export const mongoUrl = process.env.MONGO_URL;
export const databaseName = process.env.DB_NAME;
export const realtimeUrl = process.env['REALTIME_URL'];

