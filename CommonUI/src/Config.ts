import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import Version from 'Common/Types/Version';

export const env: Function = (key: string): string => {
    return process.env[`REACT_APP_${key}`] || '';
};

export const IS_SAAS_SERVICE: boolean = env('IS_SAAS_SERVICE') === 'true';
export const DISABLE_SIGNUP: boolean = env('DISABLE_SIGNUP') === 'true';
export const VERSION: Version = new Version(env('VERSION') || '');

export const BACKEND_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/api`
);

export const IDENTITY_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/identity`
);

export const DASHBOARD_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/dashboard`
);

export const INTEGRATION_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/integration`
);

export const HELM_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/charts`
);

export const API_DOCS_HOSTANME: Hostname = new Hostname(
    `${window.location.hostname}/docs`
);

export const ADMIN_DASHBOARD_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/admin`
);
export const ACCOUNTS_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}/accounts`
);
export const HOME_HOSTNAME: Hostname = new Hostname(
    `${window.location.hostname}`
);

export const API_PROTOCOL: Protocol = window.location.protocol.includes('https')
    ? Protocol.HTTPS
    : Protocol.HTTP;
