import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL } from 'CommonUI/src/Config';

export const SIGNUP_API_URL: URL = IDENTITY_URL.addRoute(new Route("/signup"));