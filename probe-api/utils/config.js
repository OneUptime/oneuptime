import packageJson from '../package.json'

export default {
    clusterKey: process.env.CLUSTER_KEY,
    fetchResourcesVersion: packageJson.version,
    mongoUrl: process.env.MONGO_URL,
    realtimeUrl: process.env['REALTIME_URL'],
};
