import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { STATUS_PAGE_IDENTITY_API_URL } from './Config';

export const LOGIN_API_URL: URL = URL.fromURL(
    STATUS_PAGE_IDENTITY_API_URL
).addRoute(new Route('/login'));

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(
    STATUS_PAGE_IDENTITY_API_URL
).addRoute(new Route('/forgot-password'));

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(
    STATUS_PAGE_IDENTITY_API_URL
).addRoute(new Route('/reset-password'));
