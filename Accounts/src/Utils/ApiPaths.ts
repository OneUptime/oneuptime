import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL } from 'CommonUI/src/Config';

export const SIGNUP_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/signup')
);
export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/login')
);

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/forgot-password')
);

export const VERIFY_EMAIL_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/verify-email')
);

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route('/reset-password')
);
