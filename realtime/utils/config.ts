import packageJson from '../package.json';

export default {
    clusterKey: process.env['CLUSTER_KEY'],
    realtimeVersion: packageJson.version,
};
