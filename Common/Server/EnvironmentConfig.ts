import {
  AccountsRoute,
  AdminDashboardRoute,
  DashboardRoute,
} from "Common/ServiceRoute";
import BillingConfig from "./BillingConfig";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";

export enum ConfigLogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export const getAllEnvVars: () => JSONObject = (): JSONObject => {
  return process.env;
};

export const IsBillingEnabled: boolean = BillingConfig.IsBillingEnabled;
export const BillingPublicKey: string = BillingConfig.BillingPublicKey;
export const BillingPrivateKey: string = BillingConfig.BillingPrivateKey;

export const DatabaseHost: Hostname = Hostname.fromString(
  process.env["DATABASE_HOST"] || "postgres",
);

export const LetsEncryptNotificationEmail: Email = Email.fromString(
  process.env["LETS_ENCRYPT_NOTIFICATION_EMAIL"] || "notifications@example.com",
);

export const LetsEncryptAccountKey: string =
  process.env["LETS_ENCRYPT_ACCOUNT_KEY"] || "";

export const DatabasePort: Port = new Port(
  process.env["DATABASE_PORT"] || "5432",
);

export const DatabaseUsername: string =
  process.env["DATABASE_USERNAME"] || "postgres";

export const DatabasePassword: string =
  process.env["DATABASE_PASSWORD"] || "password";

export const DatabaseName: string =
  process.env["DATABASE_NAME"] || "oneuptimedb";

export const DatabaseSslCa: string | undefined =
  process.env["DATABASE_SSL_CA"] || undefined;

export const DatabaseSslKey: string | undefined =
  process.env["DATABASE_SSL_KEY"] || undefined;

export const DatabaseSslCert: string | undefined =
  process.env["DATABASE_SSL_CERT"] || undefined;

export const DatabaseRejectUnauthorized: boolean =
  process.env["DATABASE_SSL_REJECT_UNAUTHORIZED"] === "true";

export const ShouldDatabaseSslEnable: boolean = Boolean(
  DatabaseSslCa || (DatabaseSslCert && DatabaseSslKey),
);

export const EncryptionSecret: ObjectID = new ObjectID(
  process.env["ENCRYPTION_SECRET"] || "secret",
);

export const AirtableApiKey: string = process.env["AIRTABLE_API_KEY"] || "";

export const AirtableBaseId: string = process.env["AIRTABLE_BASE_ID"] || "";

export const ClusterKey: ObjectID = new ObjectID(
  process.env["ONEUPTIME_SECRET"] || "secret",
);

export const HasClusterKey: boolean = Boolean(process.env["ONEUPTIME_SECRET"]);

export const AppApiHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_APP_HOSTNAME"] || "localhost"}:${
    process.env["APP_PORT"] || 80
  }`,
);

export const IngestorHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_INGESTOR_HOSTNAME"] || "localhost"}:${
    process.env["INGESTOR_PORT"] || 80
  }`,
);

export const IsolatedVMHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_ISOLATED_VM_HOSTNAME"] || "localhost"}:${
    process.env["ISOLATED_VM_PORT"] || 80
  }`,
);

export const AccountsHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_ACCOUNTS_HOSTNAME"] || "localhost"}:${
    process.env["ACCOUNTS_PORT"] || 80
  }`,
);

export const DashboardHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_DASHBOARD_HOSTNAME"] || "localhost"}:${
    process.env["DASHBOARD_PORT"] || 80
  }`,
);

export const AdminDashboardHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_ADMIN_DASHBOARD_HOSTNAME"] || "localhost"}:${
    process.env["ADMIN_DASHBOARD_PORT"] || 80
  }`,
);

export const Env: string = process.env["NODE_ENV"] || "production";

// Redis does not require password.
export const RedisHostname: string = process.env["REDIS_HOST"] || "redis";
export const RedisPort: Port = new Port(process.env["REDIS_PORT"] || "6379");
export const RedisDb: number = Number(process.env["REDIS_DB"]) || 0;
export const RedisUsername: string = process.env["REDIS_USERNAME"] || "default";
export const RedisPassword: string =
  process.env["REDIS_PASSWORD"] || "password";

export const RedisTlsCa: string | undefined =
  process.env["REDIS_TLS_CA"] || undefined;

export const RedisTlsCert: string | undefined =
  process.env["REDIS_TLS_CERT"] || undefined;

export const RedisTlsKey: string | undefined =
  process.env["REDIS_TLS_KEY"] || undefined;

export const RedisTlsSentinelMode: boolean =
  process.env["REDIS_TLS_SENTINEL_MODE"] === "true";

export const ShouldRedisTlsEnable: boolean = Boolean(
  RedisTlsCa || (RedisTlsCert && RedisTlsKey),
);

export const IsProduction: boolean =
  process.env["ENVIRONMENT"] === "production";

export const IsDevelopment: boolean =
  process.env["ENVIRONMENT"] === "development";

export const IsTest: boolean = process.env["ENVIRONMENT"] === "test";

export const SubscriptionPlans: Array<SubscriptionPlan> =
  SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const AnalyticsKey: string = process.env["ANALYTICS_KEY"] || "";
export const AnalyticsHost: string = process.env["ANALYTICS_HOST"] || "";

export const DisableAutomaticIncidentCreation: boolean =
  process.env["DISABLE_AUTOMATIC_INCIDENT_CREATION"] === "true";

export const ClickhouseHost: Hostname = Hostname.fromString(
  process.env["CLICKHOUSE_HOST"] || "clickhouse",
);

export const StatusPageCNameRecord: string =
  process.env["STATUS_PAGE_CNAME_RECORD"] || "";

export const ClickhousePort: Port = new Port(
  process.env["CLICKHOUSE_PORT"] || "8123",
);

export const ClickhouseUsername: string =
  process.env["CLICKHOUSE_USER"] || "default";

export const ClickhousePassword: string =
  process.env["CLICKHOUSE_PASSWORD"] || "password";

export const ClickhouseDatabase: string =
  process.env["CLICKHOUSE_DATABASE"] || "oneuptime";

export const ClickhouseTlsCa: string | undefined =
  process.env["CLICKHOUSE_TLS_CA"] || undefined;

export const ClickhouseTlsCert: string | undefined =
  process.env["CLICKHOUSE_TLS_CERT"] || undefined;

export const ClickhouseTlsKey: string | undefined =
  process.env["CLICKHOUSE_TLS_KEY"] || undefined;

export const ClickHouseIsHostHttps: boolean =
  process.env["CLICKHOUSE_IS_HOST_HTTPS"] === "true";

export const ShouldClickhouseSslEnable: boolean = Boolean(
  ClickhouseTlsCa || (ClickhouseTlsCert && ClickhouseTlsKey),
);

export const GitSha: string = process.env["GIT_SHA"] || "unknown";

export const AppVersion: string = process.env["APP_VERSION"] || "unknown";

export const LogLevel: ConfigLogLevel =
  (process.env["LOG_LEVEL"] as ConfigLogLevel) || ConfigLogLevel.INFO;

export const HttpProtocol: Protocol =
  process.env["HTTP_PROTOCOL"] === "https" ? Protocol.HTTPS : Protocol.HTTP;

export const Host: string = process.env["HOST"] || "";

export const WorkflowScriptTimeoutInMS: number = process.env[
  "WORKFLOW_SCRIPT_TIMEOUT_IN_MS"
]
  ? parseInt(process.env["WORKFLOW_SCRIPT_TIMEOUT_IN_MS"].toString())
  : 5000;

export const AllowedActiveMonitorCountInFreePlan: number = process.env[
  "ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN"
]
  ? parseInt(
      process.env["ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN"].toString(),
    )
  : 10;

export const AllowedStatusPageCountInFreePlan: number = process.env[
  "ALLOWED_STATUS_PAGE_COUNT_IN_FREE_PLAN"
]
  ? parseInt(process.env["ALLOWED_STATUS_PAGE_COUNT_IN_FREE_PLAN"].toString())
  : 1;

export const AllowedSubscribersCountInFreePlan: number = process.env[
  "ALLOWED_SUBSCRIBERS_COUNT_IN_FREE_PLAN"
]
  ? parseInt(process.env["ALLOWED_SUBSCRIBERS_COUNT_IN_FREE_PLAN"].toString())
  : 100;

export const NotificationWebhookOnCreateUser: string =
  process.env["NOTIFICATION_WEBHOOK_ON_CREATED_USER"] || "";

export const AdminDashboardClientURL: URL = new URL(
  HttpProtocol,
  Host,
  AdminDashboardRoute,
);

export const DashboardClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  DashboardRoute,
);

export const AccountsClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  AccountsRoute,
);

export const DisableTelemetry: boolean =
  process.env["DISABLE_TELEMETRY"] === "true";
