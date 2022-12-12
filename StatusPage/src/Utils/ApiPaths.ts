import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';

export const LOGIN_API_URL: URL = URL.fromURL(DASHBOARD_API_URL).addRoute(
    new Route('/status-page-private-user/login')
);

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(
    DASHBOARD_API_URL
).addRoute(new Route('/status-page-private-user/forgot-password'));

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(
    DASHBOARD_API_URL
).addRoute(new Route('/status-page-private-user/reset-password'));
