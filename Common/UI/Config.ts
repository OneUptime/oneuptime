import {
  AccountsRoute,
  AdminDashboardRoute,
  ApiReferenceRoute,
  AppApiRoute,
  DashboardRoute,
  DocsRoute,
  FileRoute,
  HomeRoute,
  IdentityRoute,
  ProbeIngestRoute,
  IntegrationRoute,
  NotificationRoute,
  RealtimeRoute,
  StatusPageApiRoute,
  StatusPageRoute,
  WorkflowRoute,
  FluentIngestRoute,
  IncomingRequestIngestRoute,
  OpenTelemetryIngestRoute,
} from "../ServiceRoute";
import Hostname from "../Types/API/Hostname";
import Protocol from "../Types/API/Protocol";
import URL from "../Types/API/URL";
import SubscriptionPlan from "../Types/Billing/SubscriptionPlan";
import Dictionary from "../Types/Dictionary";
import { JSONObject } from "../Types/JSON";
import Version from "../Types/Version";

type GetAllEnvVarsFunction = () => JSONObject;

export const getAllEnvVars: GetAllEnvVarsFunction = (): JSONObject => {
  const envVars: JSONObject = window?.process?.env || process?.env || {};
  return envVars;
};

type GetEnvFunction = (key: string) => string;

export const env: GetEnvFunction = (key: string): string => {
  const allEnv: JSONObject = getAllEnvVars();
  return (allEnv[key] as string) || "";
};

export const HTTP_PROTOCOL: Protocol =
  env("HTTP_PROTOCOL") === "https" ? Protocol.HTTPS : Protocol.HTTP;

export const HOST: string = env("HOST") || "";

export const BILLING_ENABLED: boolean = env("BILLING_ENABLED") === "true";
export const BILLING_PUBLIC_KEY: string = env("BILLING_PUBLIC_KEY") || "";

// VAPID Configuration for Push Notifications
export const VAPID_PUBLIC_KEY: string = env("VAPID_PUBLIC_KEY") || "";

export const VERSION: Version = new Version(env("VERSION") || "1.0.0");

export const APP_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const IDENTITY_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const NOTIFICATION_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(HOST);

// realtime
export const REALTIME_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const INTEGRATION_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const STATUS_PAGE_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const WORKFLOW_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const PROBE_INGEST_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const OPEN_TELEMETRY_INGEST_HOSTNAME: Hostname =
  Hostname.fromString(HOST);

export const INCOMING_REQUEST_INGEST_HOSTNAME: Hostname =
  Hostname.fromString(HOST);

export const FLUENT_INGEST_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const HELM_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const API_DOCS_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const ADMIN_DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const ACCOUNTS_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const HOME_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const FILE_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const APP_API_URL: URL = new URL(
  HTTP_PROTOCOL,
  APP_HOSTNAME,
  AppApiRoute,
);

export const REALTIME_URL: URL = new URL(
  HTTP_PROTOCOL,
  REALTIME_HOSTNAME,
  RealtimeRoute,
);

export const DOCS_URL: URL = new URL(
  HTTP_PROTOCOL,
  REALTIME_HOSTNAME,
  DocsRoute,
);

export const STATUS_PAGE_API_URL: URL = new URL(
  HTTP_PROTOCOL,
  STATUS_PAGE_HOSTNAME,
  StatusPageApiRoute,
);

export const OPEN_TELEMETRY_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  OPEN_TELEMETRY_INGEST_HOSTNAME,
  OpenTelemetryIngestRoute,
);

export const FLUENT_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  FLUENT_INGEST_HOSTNAME,
  FluentIngestRoute,
);

export const IDENTITY_URL: URL = new URL(
  HTTP_PROTOCOL,
  IDENTITY_HOSTNAME,
  IdentityRoute,
);

export const NOTIFICATION_URL: URL = new URL(
  HTTP_PROTOCOL,
  NOTIFICATION_HOSTNAME,
  NotificationRoute,
);

export const WORKFLOW_URL: URL = new URL(
  HTTP_PROTOCOL,
  WORKFLOW_HOSTNAME,
  WorkflowRoute,
);

export const PROBE_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  PROBE_INGEST_HOSTNAME,
  ProbeIngestRoute,
);

export const INCOMING_REQUEST_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  INCOMING_REQUEST_INGEST_HOSTNAME,
  IncomingRequestIngestRoute,
);

export const STATUS_PAGE_URL: URL = new URL(
  HTTP_PROTOCOL,
  STATUS_PAGE_HOSTNAME,
  StatusPageRoute,
);

export const FILE_URL: URL = new URL(HTTP_PROTOCOL, FILE_HOSTNAME, FileRoute);

export const DASHBOARD_URL: URL = new URL(
  HTTP_PROTOCOL,
  DASHBOARD_HOSTNAME,
  DashboardRoute,
);

export const INTEGRATION_URL: URL = new URL(
  HTTP_PROTOCOL,
  INTEGRATION_HOSTNAME,
  IntegrationRoute,
);

export const API_DOCS_URL: URL = new URL(
  HTTP_PROTOCOL,
  API_DOCS_HOSTNAME,
  ApiReferenceRoute,
);

export const ADMIN_DASHBOARD_URL: URL = new URL(
  HTTP_PROTOCOL,
  ADMIN_DASHBOARD_HOSTNAME,
  AdminDashboardRoute,
);
export const ACCOUNTS_URL: URL = new URL(
  HTTP_PROTOCOL,
  ACCOUNTS_HOSTNAME,
  AccountsRoute,
);
export const HOME_URL: URL = new URL(HTTP_PROTOCOL, HOME_HOSTNAME, HomeRoute);

export const SubscriptionPlans: Array<SubscriptionPlan> =
  SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const StatusPageCNameRecord: string =
  env("STATUS_PAGE_CNAME_RECORD") || "";

export const AnalyticsKey: string = env("ANALYTICS_KEY") || "";
export const AnalyticsHost: string = env("ANALYTICS_HOST");

export const GitSha: string = env("GIT_SHA") || "";
export const AppVersion: string = env("APP_VERSION") || "";

export const OpenTelemetryExporterOtlpEndpoint: URL | null = env(
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
)
  ? URL.fromString(env("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT").toString())
  : null;

type GetOpenTelemetryExporterOtlpHeadersFunction = () => Dictionary<string>;

const getOpenTelemetryExporterOtlpHeaders: GetOpenTelemetryExporterOtlpHeadersFunction =
  (): Dictionary<string> => {
    if (!env("OPENTELEMETRY_EXPORTER_OTLP_HEADERS")) {
      return {};
    }

    const headersStrings: Array<string> = env(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    )
      .toString()
      .split(";");

    const headers: Dictionary<string> = {};

    for (const headerString of headersStrings) {
      const header: Array<string> = headerString.split("=");
      if (header.length === 2) {
        headers[header[0]!.toString()] = header[1]!.toString();
      }
    }

    return headers;
  };

export const OpenTelemetryExporterOtlpHeaders: Dictionary<string> =
  getOpenTelemetryExporterOtlpHeaders();

export const DisableTelemetry: boolean = env("DISABLE_TELEMETRY") === "true";

export const SlackAppClientId: string | null =
  env("SLACK_APP_CLIENT_ID") || null;

export const MicrosoftTeamsAppId: string | null =
  env("MICROSOFT_TEAMS_APP_ID") || null;
