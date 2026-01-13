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
  IncomingRequestIngestRoute,
  TelemetryRoute,
} from "../ServiceRoute";
import Hostname from "../Types/API/Hostname";
import Protocol from "../Types/API/Protocol";
import URL from "../Types/API/URL";
import Route from "../Types/API/Route";
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
export const IS_ENTERPRISE_EDITION: boolean =
  env("IS_ENTERPRISE_EDITION") === "true";
export const BILLING_PUBLIC_KEY: string = env("BILLING_PUBLIC_KEY") || "";

export const CAPTCHA_ENABLED: boolean = env("CAPTCHA_ENABLED") === "true";
export const CAPTCHA_SITE_KEY: string = env("CAPTCHA_SITE_KEY") || "";

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

export const TELEMETRY_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const INCOMING_REQUEST_INGEST_HOSTNAME: Hostname =
  Hostname.fromString(HOST);

export const HELM_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const API_DOCS_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const ADMIN_DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const ACCOUNTS_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const HOME_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const FILE_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const APP_API_URL: URL = new URL(
  HTTP_PROTOCOL,
  APP_HOSTNAME,
  new Route(AppApiRoute.toString()),
);

export const REALTIME_URL: URL = new URL(
  HTTP_PROTOCOL,
  REALTIME_HOSTNAME,
  new Route(RealtimeRoute.toString()),
);

export const DOCS_URL: URL = new URL(
  HTTP_PROTOCOL,
  REALTIME_HOSTNAME,
  new Route(DocsRoute.toString()),
);

export const STATUS_PAGE_API_URL: URL = new URL(
  HTTP_PROTOCOL,
  STATUS_PAGE_HOSTNAME,
  new Route(StatusPageApiRoute.toString()),
);

export const TELEMETRY_URL: URL = new URL(
  HTTP_PROTOCOL,
  TELEMETRY_HOSTNAME,
  new Route(TelemetryRoute.toString()),
);

export const IDENTITY_URL: URL = new URL(
  HTTP_PROTOCOL,
  IDENTITY_HOSTNAME,
  new Route(IdentityRoute.toString()),
);

export const NOTIFICATION_URL: URL = new URL(
  HTTP_PROTOCOL,
  NOTIFICATION_HOSTNAME,
  new Route(NotificationRoute.toString()),
);

export const WORKFLOW_URL: URL = new URL(
  HTTP_PROTOCOL,
  WORKFLOW_HOSTNAME,
  new Route(WorkflowRoute.toString()),
);

export const PROBE_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  PROBE_INGEST_HOSTNAME,
  new Route(ProbeIngestRoute.toString()),
);

export const INCOMING_REQUEST_INGEST_URL: URL = new URL(
  HTTP_PROTOCOL,
  INCOMING_REQUEST_INGEST_HOSTNAME,
  new Route(IncomingRequestIngestRoute.toString()),
);

export const STATUS_PAGE_URL: URL = new URL(
  HTTP_PROTOCOL,
  STATUS_PAGE_HOSTNAME,
  new Route(StatusPageRoute.toString()),
);

export const FILE_URL: URL = new URL(
  HTTP_PROTOCOL,
  FILE_HOSTNAME,
  new Route(FileRoute.toString()),
);

export const DASHBOARD_URL: URL = new URL(
  HTTP_PROTOCOL,
  DASHBOARD_HOSTNAME,
  new Route(DashboardRoute.toString()),
);

export const INTEGRATION_URL: URL = new URL(
  HTTP_PROTOCOL,
  INTEGRATION_HOSTNAME,
  new Route(IntegrationRoute.toString()),
);

export const API_DOCS_URL: URL = new URL(
  HTTP_PROTOCOL,
  API_DOCS_HOSTNAME,
  new Route(ApiReferenceRoute.toString()),
);

export const ADMIN_DASHBOARD_URL: URL = new URL(
  HTTP_PROTOCOL,
  ADMIN_DASHBOARD_HOSTNAME,
  new Route(AdminDashboardRoute.toString()),
);
export const ACCOUNTS_URL: URL = new URL(
  HTTP_PROTOCOL,
  ACCOUNTS_HOSTNAME,
  new Route(AccountsRoute.toString()),
);
export const HOME_URL: URL = new URL(
  HTTP_PROTOCOL,
  HOME_HOSTNAME,
  new Route(HomeRoute.toString()),
);

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

export const MicrosoftTeamsAppClientId: string | null =
  env("MICROSOFT_TEAMS_APP_CLIENT_ID") || null;

export const GitHubAppClientId: string | null =
  env("GITHUB_APP_CLIENT_ID") || null;

export const GitHubAppName: string | null = env("GITHUB_APP_NAME") || null;

export const INBOUND_EMAIL_DOMAIN: string =
  env("INBOUND_EMAIL_DOMAIN") || "inbound.oneuptime.com";
