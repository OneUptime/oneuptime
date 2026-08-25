import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { IDENTITY_URL, APP_API_URL } from "Common/UI/Config";

export const SIGNUP_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/signup"),
);
export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/login"),
);

export const VERIFY_TOTP_AUTH_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/verify-totp-auth"),
);

/*
 * Finishes a two factor auth setup an admin made mandatory, and signs the user
 * in at the same time. Reached only when /login answers with
 * `twoFactorEnrolmentRequired` -- there is no session at this point, so the
 * request carries the email and password again, exactly as the TOTP challenge
 * above does.
 */
export const VERIFY_TOTP_ENROLMENT_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/verify-totp-enrolment"));

/*
 * Signs a user in with one of their single-use recovery codes, for the day the
 * authenticator app or security key is not available. Reached only from the
 * two factor challenge screen, and only when /login reported that the account
 * has unused codes -- so, like the two routes above, this request carries the
 * email and password again: there is no session yet to authenticate it with.
 */
export const VERIFY_BACKUP_CODE_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/verify-backup-code"));

export const GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL: URL = URL.fromURL(
  APP_API_URL,
).addRoute(new Route("/user-webauthn/generate-authentication-options"));

export const VERIFY_WEBAUTHN_AUTH_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/verify-webauthn-auth"));

export const SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/service-provider-login"));

export const SERVICE_PROVIDER_LOGIN_OIDC_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/service-provider-login-oidc"));

export const GLOBAL_SSO_SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/global-sso/service-provider-login"));

export const GLOBAL_OIDC_SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/global-oidc/service-provider-login"));

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/forgot-password"),
);

export const VERIFY_EMAIL_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/verify-email"),
);

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/reset-password"),
);
