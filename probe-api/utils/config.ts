import packageJson from '../package.json';

export const clusterKey = process.env.CLUSTER_KEY;
export const fetchResourcesVersion = packageJson.version;
export const realtimeUrl = process.env['REALTIME_URL'];
