import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import Route from 'Common/Types/API/Route';
import Version from 'Common/Types/Version';
import URL from 'Common/Types/API/URL';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import { JSONObject } from 'Common/Types/JSON';

export const getAllEnvVars: Function = (): JSONObject => {
    return window?.process?.env || process?.env || {};
};

export const env: Function = (key: string): string => {
    return (getAllEnvVars()[key] as string) || '';
};

export const HTTP_PROTOCOL: Protocol =
    env('HTTP_PROTOCOL') === 'http' ? Protocol.HTTP : Protocol.HTTPS;

export const DOMAIN: string = env('DOMAIN') || '';

export const BILLING_ENABLED: boolean = env('BILLING_ENABLED') === 'true';
export const BILLING_PUBLIC_KEY: string = env('BILLING_PUBLIC_KEY') || '';
export const DISABLE_SIGNUP: boolean = env('DISABLE_SIGNUP') === 'true';
export const VERSION: Version = new Version(env('VERSION') || '1.0.0');

export const DASHBOARD_API_ROUTE: Route = new Route(env('DASHBOARD_API_ROUTE'));

export const IDENTITY_ROUTE: Route = new Route(env('IDENTITY_ROUTE'));

export const WORKFLOW_ROUTE: Route = new Route(env('WORKFLOW_ROUTE'));

export const FILE_ROUTE: Route = new Route(env('FILE_ROUTE'));

export const MAIL_ROUTE: Route = new Route(env('MAIL_ROUTE'));

export const STATUS_PAGE_ROUTE: Route = new Route(env('STATUS_PAGE_ROUTE'));

export const DASHBOARD_ROUTE: Route = new Route(env('DASHBOARD_ROUTE'));

export const INTEGRATION_ROUTE: Route = new Route(env('INTEGRATION_ROUTE'));

export const HELM_ROUTE: Route = new Route(env('HELMCHART_ROUTE'));

export const API_DOCS_ROUTE: Route = new Route(env('ApiReference_ROUTE'));

export const ADMIN_DASHBOARD_ROUTE: Route = new Route(
    env('ADMINDASHBOARD_ROUTE')
);
export const ACCOUNTS_ROUTE: Route = new Route(env('ACCOUNTS_ROUTE'));
export const HOME_ROUTE: Route = new Route(env('HOME_ROUTE'));

export const DASHBOARD_API_HOSTNAME: Hostname = Hostname.fromString(
    env('DOMAIN')
);

export const IDENTITY_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const MAIL_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const INTEGRATION_HOSTNAME: Hostname = Hostname.fromString(
    env('DOMAIN')
);

export const STATUS_PAGE_HOSTNAME: Hostname = Hostname.fromString(
    env('DOMAIN')
);

export const WORKFLOW_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const HELM_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const API_DOCS_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const ADMIN_DASHBOARD_HOSTNAME: Hostname = Hostname.fromString(
    env('DOMAIN')
);
export const ACCOUNTS_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));
export const HOME_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const FILE_HOSTNAME: Hostname = Hostname.fromString(env('DOMAIN'));

export const DASHBOARD_API_URL: URL = new URL(
    HTTP_PROTOCOL,
    DASHBOARD_API_HOSTNAME,
    DASHBOARD_API_ROUTE
);

export const IDENTITY_URL: URL = new URL(
    HTTP_PROTOCOL,
    IDENTITY_HOSTNAME,
    IDENTITY_ROUTE
);

export const MAIL_URL: URL = new URL(HTTP_PROTOCOL, MAIL_HOSTNAME, MAIL_ROUTE);

export const WORKFLOW_URL: URL = new URL(
    HTTP_PROTOCOL,
    WORKFLOW_HOSTNAME,
    WORKFLOW_ROUTE
);

export const STATUS_PAGE_URL: URL = new URL(
    HTTP_PROTOCOL,
    STATUS_PAGE_HOSTNAME,
    STATUS_PAGE_ROUTE
);

export const FILE_URL: URL = new URL(HTTP_PROTOCOL, FILE_HOSTNAME, FILE_ROUTE);

export const DASHBOARD_URL: URL = new URL(
    HTTP_PROTOCOL,
    DASHBOARD_HOSTNAME,
    DASHBOARD_ROUTE
);

export const INTEGRATION_URL: URL = new URL(
    HTTP_PROTOCOL,
    INTEGRATION_HOSTNAME,
    INTEGRATION_ROUTE
);

export const HELM_URL: URL = new URL(HTTP_PROTOCOL, HELM_HOSTNAME, HELM_ROUTE);

export const API_DOCS_URL: URL = new URL(
    HTTP_PROTOCOL,
    API_DOCS_HOSTNAME,
    API_DOCS_ROUTE
);

export const ADMIN_DASHBOARD_URL: URL = new URL(
    HTTP_PROTOCOL,
    ADMIN_DASHBOARD_HOSTNAME,
    ADMIN_DASHBOARD_ROUTE
);
export const ACCOUNTS_URL: URL = new URL(
    HTTP_PROTOCOL,
    ACCOUNTS_HOSTNAME,
    ACCOUNTS_ROUTE
);
export const HOME_URL: URL = new URL(HTTP_PROTOCOL, HOME_HOSTNAME, HOME_ROUTE);

export const SubscriptionPlans: Array<SubscriptionPlan> =
    SubscriptionPlan.getSubscriptionPlans(getAllEnvVars());

export const StatusPageCNameRecord: string =
    env('STATUS_PAGE_CNAME_RECORD') || '';

export const AnalyticsKey: string = env('ANALYTICS_KEY') || '';
export const AnalyticsHost: string = env('ANALYTICS_HOST');
