import Hostname from 'Common/Types/api/hostname';
import Protocol from 'Common/Types/api/protocol';

export const env: Function = (key: string): string => {
    return process.env['`REACT_APP_']${key}`] || '';
};

export const IS_SAAS_SERVICE: $TSFixMe = env('IS_SAAS_SERVICE') === 'true';
export const DISABLE_SIGNUP: $TSFixMe = env('DISABLE_SIGNUP') === 'true';
export const VERSION: $TSFixMe = env('VERSION');

export const BACKEND_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}/api`
);

export const DASHBOARD_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}/dashboard`
);

export const HELM_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}/charts`
);

export const API_DOCS_HOSTANME: $TSFixMe = new Hostname(
    `${window.location.hostname}/docs`
);

export const ADMIN_DASHBOARD_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}/admin`
);
export const ACCOUNTS_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}/accounts`
);
export const HOME_HOSTNAME: $TSFixMe = new Hostname(
    `${window.location.hostname}`
);

export const API_PROTOCOL: Protocol = window.location.protocol.includes('https')
    ? Protocol.HTTPS
    : Protocol.HTTP;
