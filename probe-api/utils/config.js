const packageJson = require('../package.json');

module.exports = {
    clusterKey: process.env.CLUSTER_KEY,
    fetchResourcesVersion: packageJson.version,
    mongoUrl: process.env.MONGO_URL,
    realtimeUrl: process.env['REALTIME_URL'],
};
