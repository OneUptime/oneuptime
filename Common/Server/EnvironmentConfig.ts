import {
  AccountsRoute,
  AdminDashboardRoute,
  DashboardRoute,
  AppApiRoute,
  StatusPageApiRoute,
  DocsRoute,
  HomeRoute,
} from "../ServiceRoute";
import BillingConfig from "./BillingConfig";
import Protocol from "../Types/API/Protocol";
import URL from "../Types/API/URL";
import Route from "../Types/API/Route";
import SubscriptionPlan from "../Types/Billing/SubscriptionPlan";
import Email from "../Types/Email";
import { JSONObject } from "../Types/JSON";
import ObjectID from "../Types/ObjectID";
import Port from "../Types/Port";
import Hostname from "../Types/API/Hostname";
import ConfigLogLevel from "./Types/ConfigLogLevel";

export const getAllEnvVars: () => JSONObject = (): JSONObject => {
  return process.env;
};

const FRONTEND_ENV_ALLOW_LIST: Array<string> = [
  "NODE_ENV",
  "HTTP_PROTOCOL",
  "HOST",
  "BILLING_ENABLED",
  "BILLING_PUBLIC_KEY",
  "IS_ENTERPRISE_EDITION",
  "STRIPE_PUBLIC_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "VERSION",
  "STATUS_PAGE_CNAME_RECORD",
  "ANALYTICS_KEY",
  "ANALYTICS_HOST",
  "GIT_SHA",
  "APP_VERSION",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "DISABLE_TELEMETRY",
  "SLACK_APP_CLIENT_ID",
  "MICROSOFT_TEAMS_APP_CLIENT_ID",
  "CAPTCHA_ENABLED",
  "CAPTCHA_SITE_KEY",
];

const FRONTEND_ENV_ALLOW_PREFIXES: Array<string> = [
  "SUBSCRIPTION_PLAN_",
  "PUBLIC_",
];

export const getFrontendEnvVars: () => JSONObject = (): JSONObject => {
  const frontendEnv: JSONObject = {};

  for (const key of Object.keys(process.env)) {
    const shouldInclude: boolean =
      FRONTEND_ENV_ALLOW_LIST.includes(key) ||
      FRONTEND_ENV_ALLOW_PREFIXES.some((prefix: string) => {
        return key.startsWith(prefix);
      });

    if (!shouldInclude) {
      continue;
    }

    const value: string | undefined = process.env[key];

    if (typeof value !== "undefined") {
      frontendEnv[key] = value;
    }
  }

  return frontendEnv;
};

const parsePositiveNumberFromEnv: (
  envKey: string,
  fallback: number,
) => number = (envKey: string, fallback: number): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseFloat(rawValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
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

export const ProbeIngestHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_PROBE_INGEST_HOSTNAME"] || "localhost"}:${
    process.env["PROBE_INGEST_PORT"] || 80
  }`,
);

export const OpenTelemetryIngestHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_TELEMETRY_HOSTNAME"] || "localhost"}:${
    process.env["TELEMETRY_PORT"] || 80
  }`,
);

export const IncomingRequestIngestHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_INCOMING_REQUEST_INGEST_HOSTNAME"] || "localhost"}:${
    process.env["INCOMING_REQUEST_INGEST_PORT"] || 80
  }`,
);

export const IsolatedVMHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_ISOLATED_VM_HOSTNAME"] || "localhost"}:${
    process.env["ISOLATED_VM_PORT"] || 80
  }`,
);

export const WorkerHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_WORKER_HOSTNAME"] || "localhost"}:${
    process.env["WORKER_PORT"] || 80
  }`,
);

export const WorkflowHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_WORKFLOW_HOSTNAME"] || "localhost"}:${
    process.env["WORKFLOW_PORT"] || 80
  }`,
);

export const HomeHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_HOME_HOSTNAME"] || "localhost"}:${
    process.env["HOME_PORT"] || 80
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

export const DocsHostname: Hostname = Hostname.fromString(
  `${process.env["SERVER_DOCS_HOSTNAME"] || "localhost"}:${
    process.env["DOCS_PORT"] || 80
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

export const RedisIPFamily: number = process.env["REDIS_IP_FAMILY"]
  ? Number(process.env["REDIS_IP_FAMILY"])
  : 4;

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

export const DisableAutomaticAlertCreation: boolean =
  process.env["DISABLE_AUTOMATIC_ALERT_CREATION"] === "true";

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

export const ProvisionSsl: boolean = process.env["PROVISION_SSL"] === "true";

export const CaptchaEnabled: boolean =
  process.env["CAPTCHA_ENABLED"] === "true";

export const CaptchaSecretKey: string =
  process.env["CAPTCHA_SECRET_KEY"] || "";

export const CaptchaSiteKey: string =
  process.env["CAPTCHA_SITE_KEY"] || "";

export const WorkflowScriptTimeoutInMS: number = process.env[
  "WORKFLOW_SCRIPT_TIMEOUT_IN_MS"
]
  ? parseInt(process.env["WORKFLOW_SCRIPT_TIMEOUT_IN_MS"].toString())
  : 5000;

export const WorkflowTimeoutInMs: number = process.env["WORKFLOW_TIMEOUT_IN_MS"]
  ? parseInt(process.env["WORKFLOW_TIMEOUT_IN_MS"].toString())
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

export const NotificationSlackWebhookOnCreateUser: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER"] || "";

export const NotificationSlackWebhookOnCreateProject: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT"] || "";

// notification delete project
export const NotificationSlackWebhookOnDeleteProject: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT"] || "";

// notification subscripton update.
export const NotificationSlackWebhookOnSubscriptionUpdate: string =
  process.env["NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE"] || "";

export const AdminDashboardClientURL: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AdminDashboardRoute.toString()),
);

export const AppApiClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AppApiRoute.toString()),
);

export const StatusPageApiClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(StatusPageApiRoute.toString()),
);

export const DashboardClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(DashboardRoute.toString()),
);

export const AccountsClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(AccountsRoute.toString()),
);

export const HomeClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(HomeRoute.toString()),
);

export const DocsClientUrl: URL = new URL(
  HttpProtocol,
  Host,
  new Route(DocsRoute.toString()),
);

export const DisableTelemetry: boolean =
  process.env["DISABLE_TELEMETRY"] === "true";

export const IsEnterpriseEdition: boolean =
  process.env["IS_ENTERPRISE_EDITION"] === "true";

export const AverageSpanRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_SPAN_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageLogRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_LOG_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageMetricRowSizeInBytes: number = parsePositiveNumberFromEnv(
  "AVERAGE_METRIC_ROW_SIZE_IN_BYTES",
  1024,
);

export const AverageExceptionRowSizeInBytes: number =
  parsePositiveNumberFromEnv("AVERAGE_EXCEPTION_ROW_SIZE_IN_BYTES", 1024);

export const SlackAppClientId: string | null =
  process.env["SLACK_APP_CLIENT_ID"] || null;
export const SlackAppClientSecret: string | null =
  process.env["SLACK_APP_CLIENT_SECRET"] || null;
export const SlackAppSigningSecret: string | null =
  process.env["SLACK_APP_SIGNING_SECRET"] || null;

// Microsoft Teams Configuration
export const MicrosoftTeamsAppClientId: string | null =
  process.env["MICROSOFT_TEAMS_APP_CLIENT_ID"] || null;
export const MicrosoftTeamsAppClientSecret: string | null =
  process.env["MICROSOFT_TEAMS_APP_CLIENT_SECRET"] || null;

// VAPID Configuration for Web Push Notifications
export const VapidPublicKey: string | undefined =
  process.env["VAPID_PUBLIC_KEY"] || undefined;

export const VapidPrivateKey: string | undefined =
  process.env["VAPID_PRIVATE_KEY"] || undefined;

export const VapidSubject: string =
  process.env["VAPID_SUBJECT"] || "mailto:support@oneuptime.com";

export const EnterpriseLicenseValidationUrl: URL = URL.fromString(
  "https://oneuptime.com/api/enterprise-license/validate",
);
