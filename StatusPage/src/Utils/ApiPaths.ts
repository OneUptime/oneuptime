import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL } from 'CommonUI/src/Config';

export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/status-page/login')
);

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/status-page/forgot-password')
);

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/status-page/reset-password')
);

