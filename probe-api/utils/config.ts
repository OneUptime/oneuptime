// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../package.json'. Consider usi... Remove this comment to see the full error message
import packageJson from '../package.json'

export default {
    clusterKey: process.env.CLUSTER_KEY,
    fetchResourcesVersion: packageJson.version,
    mongoUrl: process.env.MONGO_URL,
    realtimeUrl: process.env['REALTIME_URL'],
};
