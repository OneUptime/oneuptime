// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../package.json'. Consider usi... Remove this comment to see the full error message
import packageJson from '../package.json'

export default {
    clusterKey: process.env['CLUSTER_KEY'],
    realtimeVersion: packageJson.version,
};
