import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL } from 'CommonUI/src/Config';

export const SIGNUP_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(new Route('/signup'));
export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(new Route('/login'));