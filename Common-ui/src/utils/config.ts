import Hostname from 'Common/Types/api/hostname';
import Protocol from 'Common/Types/api/protocol';

export const env = (key: string): string => {
    return process.env[`REACT_APP_${key}`] || '';
};

export const IS_SAAS_SERVICE = env('IS_SAAS_SERVICE') === 'true';
export const DISABLE_SIGNUP = env('DISABLE_SIGNUP') === 'true';
export const VERSION = env('VERSION');

export const BACKEND_HOSTNAME = new Hostname(`${window.location.hostname}/api`);

export const DASHBOARD_HOSTNAME = new Hostname(
    `${window.location.hostname}/dashboard`
);

export const HELM_HOSTNAME = new Hostname(`${window.location.hostname}/charts`);

export const API_DOCS_HOSTANME = new Hostname(
    `${window.location.hostname}/docs`
);

export const ADMIN_DASHBOARD_HOSTNAME = new Hostname(
    `${window.location.hostname}/admin`
);
export const ACCOUNTS_HOSTNAME = new Hostname(
    `${window.location.hostname}/accounts`
);
export const HOME_HOSTNAME = new Hostname(`${window.location.hostname}`);

export const API_PROTOCOL: Protocol = window.location.protocol.includes('https')
    ? Protocol.HTTPS
    : Protocol.HTTP;
