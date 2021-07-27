const packageJson = require('../package.json');

module.exports = {
    clusterKey: process.env['CLUSTER_KEY'],
    realtimeVersion: packageJson.version,
};
