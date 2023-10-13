import ObjectID from 'Common/Types/ObjectID';
import Port from 'Common/Types/Port';
import Hostname from 'Common/Types/API/Hostname';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';

export const getAllEnvVars: () => JSONObject = (): JSONObject => {
    return process.env;
};

export const IsBillingEnabled: boolean =
    process.env['BILLING_ENABLED'] === 'true';
export const BillingPublicKey: string = process.env['BILLING_PUBLIC_KEY'] || '';
export const BillingPrivateKey: string =
    process.env['BILLING_PRIVATE_KEY'] || '';

export const DatabaseHost: Hostname = Hostname.fromString(
    process.env['DATABASE_HOST'] || 'postgres'
);

export const DatabasePort: Port = new Port(
    process.env['DATABASE_PORT'] || '5432'
);

export const DatabaseUsername: string =
    process.env['DATABASE_USERNAME'] || 'postgres';

export const DatabasePassword: string =
    process.env['DATABASE_PASSWORD'] || 'password';

export const DatabaseName: string =
    process.env['DATABASE_NAME'] || 'oneuptimedb';

export const DatabaseSslCa: string | undefined =
    process.env['DATABASE_SSL_CA'] || undefined;

export const DatabaseSslKey: string | undefined =
    process.env['DATABASE_SSL_KEY'] || undefined;

export const DatabaseSslCert: string | undefined =
    process.env['DATABASE_SSL_CERT'] || undefined;

export const DatabaseRejectUnauthorized: boolean =
    process.env['DATABASE_SSL_REJECT_UNAUTHORIZED'] === 'true';

export const ShouldDatabaseSslEnable: boolean = Boolean(
    DatabaseSslCa || (DatabaseSslCert && DatabaseSslKey)
);

export const EncryptionSecret: ObjectID = new ObjectID(
    process.env['ENCRYPTION_SECRET'] || 'secret'
);

export const AirtableApiKey: string = process.env['AIRTABLE_API_KEY'] || '';

export const AirtableBaseId: string = process.env['AIRTABLE_BASE_ID'] || '';

export const ClusterKey: ObjectID = new ObjectID(
    process.env['ONEUPTIME_SECRET'] || 'secret'
);

export const HasClusterKey: boolean = Boolean(process.env['ONEUPTIME_SECRET']);

export const RealtimeHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_REALTIME_HOSTNAME'] || 'localhost'}:${
        process.env['REALTIME_PORT'] || 80
    }`
);

export const NotificationHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_NOTIFICATION_HOSTNAME'] || 'localhost'}:${
        process.env['NOTIFICATION_PORT'] || 80
    }`
);

export const WorkerHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_WORKERS_HOSTNAME'] || 'localhost'}:${
        process.env['WORKERS_PORT'] || 80
    }`
);

export const LinkShortenerHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_LINK_SHORTENER_HOSTNAME' || 'localhost']}:${
        process.env['LINK_SHORTENER_PORT'] || 80
    }`
);

export const WorkflowHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_WORKFLOW_HOSTNAME'] || 'localhost'}:${
        process.env['WORKFLOW_PORT'] || 80
    }`
);

export const DashboardApiHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_DASHBOARD_API_HOSTNAME'] || 'localhost'}:${
        process.env['DASHBOARD_API_PORT'] || 80
    }`
);

export const IngestorHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_INGESTOR_HOSTNAME'] || 'localhost'}:${
        process.env['INGESTOR_PORT'] || 80
    }`
);

export const AccountsHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_ACCOUNTS_HOSTNAME'] || 'localhost'}:${
        process.env['ACCOUNTS_PORT'] || 80
    }`
);

export const HomeHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_HOME_HOSTNAME'] || 'localhost'}:${
        process.env['HOME_PORT'] || 80
    }`
);

export const DashboardHostname: Hostname = Hostname.fromString(
    `${process.env['SERVER_DASHBOARD_HOSTNAME'] || 'localhost'}:${
        process.env['DASHBOARD_PORT'] || 80
    }`
);

export const Env: string = process.env['NODE_ENV'] || 'production';

// Redis does not require password.
export const RedisHostname: string = process.env['REDIS_HOST'] || 'redis';
export const RedisPort: Port = new Port(process.env['REDIS_PORT'] || '6379');
export const RedisDb: number = Number(process.env['REDIS_DB']) || 0;
export const RedisUsername: string = process.env['REDIS_USERNAME'] || 'default';
export const RedisPassword: string =
    process.env['REDIS_PASSWORD'] || 'password';
export const RedisTlsCa: string | undefined =
    process.env['REDIS_TLS_CA'] || undefined;
export const RedisTlsSentinelMode: boolean =
    process.env['REDIS_TLS_SENTINEL_MODE'] === 'true';

export const ShouldRedisTlsEnable: boolean = Boolean(
    RedisTlsCa || RedisTlsSentinelMode
);

export const IsProduction: boolean =
    process.env['ENVIRONMENT'] === 'production';

export const IsDevelopment: boolean =
    process.env['ENVIRONMENT'] === 'development';

export const IsTest: boolean = process.env['ENVIRONMENT'] === 'test';

export const SubscriptionPlans: Array<SubscriptionPlan> =
    SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const AnalyticsKey: string = process.env['ANALYTICS_KEY'] || '';
export const AnalyticsHost: string = process.env['ANALYTICS_HOST'] || '';

export const DisableAutomaticIncidentCreation: boolean =
    process.env['DISABLE_AUTOMATIC_INCIDENT_CREATION'] === 'true';

export const ClickhouseHost: Hostname = Hostname.fromString(
    process.env['CLICKHOUSE_HOST'] || 'clickhouse'
);

export const ClickhousePort: Port = new Port(
    process.env['CLICKHOUSE_PORT'] || '8123'
);

export const ClickhouseUsername: string =
    process.env['CLICKHOUSE_USER'] || 'default';

export const ClickhousePassword: string =
    process.env['CLICKHOUSE_PASSWORD'] || 'password';

export const ClickhouseDatabase: string =
    process.env['CLICKHOUSE_DATABASE'] || 'oneuptime';

export const GitSha: string = process.env['GIT_SHA'] || 'unknown';

export const AppVersion: string = process.env['APP_VERSION'] || 'unknown';
