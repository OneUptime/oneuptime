import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import {
    AccountsRoute,
    AdminDashboardRoute,
    ApiReferenceRoute,
    DashboardApiRoute,
    DashboardRoute,
    FileRoute,
    IdentityRoute,
    IntegrationRoute,
    NotificationRoute,
    IngestorRoute,
    StatusPageRoute,
    WorkflowRoute,
    homeRoute,
} from 'Common/ServiceRoute';
import Version from 'Common/Types/Version';
import URL from 'Common/Types/API/URL';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';

export const getAllEnvVars: Function = (): JSONObject => {
    const envVars: JSONObject = window?.process?.env || process?.env || {};
    return envVars;
};

export const env: Function = (key: string): string => {
    const allEnv: JSONObject = getAllEnvVars();
    return (allEnv[key] as string) || '';
};

export const HTTP_PROTOCOL: Protocol =
    env('HTTP_PROTOCOL') === 'https' ? Protocol.HTTPS : Protocol.HTTP;

export const HOST: string = env('HOST') || '';

export const BILLING_ENABLED: boolean = env('BILLING_ENABLED') === 'true';
export const BILLING_PUBLIC_KEY: string = env('BILLING_PUBLIC_KEY') || '';

export const VERSION: Version = new Version(env('VERSION') || '1.0.0');

export const DASHBOARD_API_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const IDENTITY_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const NOTIFICATION_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const INTEGRATION_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const STATUS_PAGE_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const WORKFLOW_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const INGESTOR_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const HELM_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const API_DOCS_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const ADMIN_DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const ACCOUNTS_HOSTNAME: Hostname = Hostname.fromString(HOST);
export const HOME_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const FILE_HOSTNAME: Hostname = Hostname.fromString(HOST);

export const DASHBOARD_API_URL: URL = new URL(
    HTTP_PROTOCOL,
    DASHBOARD_API_HOSTNAME,
    DashboardApiRoute
);

export const IDENTITY_URL: URL = new URL(
    HTTP_PROTOCOL,
    IDENTITY_HOSTNAME,
    IdentityRoute
);

export const NOTIFICATION_URL: URL = new URL(
    HTTP_PROTOCOL,
    NOTIFICATION_HOSTNAME,
    NotificationRoute
);

export const WORKFLOW_URL: URL = new URL(
    HTTP_PROTOCOL,
    WORKFLOW_HOSTNAME,
    WorkflowRoute
);

export const INGESTOR_URL: URL = new URL(
    HTTP_PROTOCOL,
    INGESTOR_HOSTNAME,
    IngestorRoute
);

export const STATUS_PAGE_URL: URL = new URL(
    HTTP_PROTOCOL,
    STATUS_PAGE_HOSTNAME,
    StatusPageRoute
);

export const FILE_URL: URL = new URL(HTTP_PROTOCOL, FILE_HOSTNAME, FileRoute);

export const DASHBOARD_URL: URL = new URL(
    HTTP_PROTOCOL,
    DASHBOARD_HOSTNAME,
    DashboardRoute
);

export const INTEGRATION_URL: URL = new URL(
    HTTP_PROTOCOL,
    INTEGRATION_HOSTNAME,
    IntegrationRoute
);

export const API_DOCS_URL: URL = new URL(
    HTTP_PROTOCOL,
    API_DOCS_HOSTNAME,
    ApiReferenceRoute
);

export const ADMIN_DASHBOARD_URL: URL = new URL(
    HTTP_PROTOCOL,
    ADMIN_DASHBOARD_HOSTNAME,
    AdminDashboardRoute
);
export const ACCOUNTS_URL: URL = new URL(
    HTTP_PROTOCOL,
    ACCOUNTS_HOSTNAME,
    AccountsRoute
);
export const HOME_URL: URL = new URL(HTTP_PROTOCOL, HOME_HOSTNAME, homeRoute);

export const SubscriptionPlans: Array<SubscriptionPlan> =
    SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const StatusPageCNameRecord: string =
    env('STATUS_PAGE_CNAME_RECORD') || '';

export const AnalyticsKey: string = env('ANALYTICS_KEY') || '';
export const AnalyticsHost: string = env('ANALYTICS_HOST');

export const GitSha: string = env('GIT_SHA') || '';
export const AppVersion: string = env('APP_VERSION') || '';
