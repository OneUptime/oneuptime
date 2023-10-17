import URL from 'Common/Types/API/URL';
import Route from 'Common/Types/API/Route';
import Protocol from 'Common/Types/API/Protocol';

const PROTOCOL: Protocol = window.location.protocol.includes('https')
    ? Protocol.HTTPS
    : Protocol.HTTP;

export const STATUS_PAGE_API_URL: URL = new URL(
    PROTOCOL,
    window.location.host,
    new Route('/status-page-api')
);

export const STATUS_PAGE_SSO_API_URL: URL = new URL(
    PROTOCOL,
    window.location.host,
    new Route('/status-page-sso-api')
);

export const STATUS_PAGE_IDENTITY_API_URL: URL = new URL(
    PROTOCOL,
    window.location.host,
    new Route('/status-page-identity-api')
);
