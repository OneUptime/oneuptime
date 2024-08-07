import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { IDENTITY_URL } from "Common/UI/Config";

export const SIGNUP_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/signup"),
);
export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/login"),
);

export const VERIFY_TWO_FACTOR_AUTH_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/verify-two-factor-auth"));

export const SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/service-provider-login"));

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/forgot-password"),
);

export const VERIFY_EMAIL_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/verify-email"),
);

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/reset-password"),
);
