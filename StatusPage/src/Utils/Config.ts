import { HOST, HTTP_PROTOCOL } from 'CommonUI/src/Config';
import URL from 'Common/Types/API/URL';
import Route from 'Common/Types/API/Route';

export const STATUS_PAGE_API_URL: URL = new URL(
    HTTP_PROTOCOL,
    HOST,
    new Route('/status-page-api')
);

export const STATUS_PAGE_SSO_API_URL: URL = new URL(
    HTTP_PROTOCOL,
    HOST,
    new Route('/status-page-sso-api')
);

export const STATUS_PAGE_IDENTITY_API_URL: URL = new URL(
    HTTP_PROTOCOL,
    HOST,
    new Route('/status-page-identity-api')
);
