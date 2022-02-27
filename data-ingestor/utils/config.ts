// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../package.json'. Consider usi... Remove this comment to see the full error message
import packageJson from '../package.json';

export default {
    serverUrl: process.env['SERVER_URL'],
    clusterKey: process.env['CLUSTER_KEY'],
    dataIngestorVersion: packageJson.version,
    mongoUrl:
        process.env['MONGO_URL'] || 'mongodb://localhost:27017/oneuptimedb',
    scriptBaseUrl: process.env['SCRIPT_RUNNER_URL'],
    realtimeUrl: process.env['REALTIME_URL'],
    databaseName: process.env['DB_NAME'],
};
