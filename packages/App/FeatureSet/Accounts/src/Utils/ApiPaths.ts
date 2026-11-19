import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { IDENTITY_URL, APP_API_URL } from "Common/UI/Config";
import { SIGN_UP_INVITATION_ROUTE } from "Common/Types/Accounts/SignUpInvitation";
import {
  MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE,
  SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE,
  VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
} from "Common/Types/Accounts/SecondStepEnrolment";
import { SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE } from "Common/Types/Accounts/SecurityKeySignIn";
import { getProjectSignInMethodsRoute } from "Common/Types/SSO/SignInMethods";

export const SIGNUP_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/signup"),
);
export const LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/login"),
);

/*
 * Whether this self-hosted server is waiting for its first account, which
 * becomes its admin: the register page says so then.
 */
export const FIRST_ACCOUNT_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/first-account"),
);

/*
 * The invitation a sign-up link is for (#7471): the register page an
 * invitation opens asks, with the link's address and token, which project
 * invited the person and who.
 */
export const SIGN_UP_INVITATION_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route(SIGN_UP_INVITATION_ROUTE));

export const PASSKEY_LOGIN_OPTIONS_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/passkey-login-options"));

export const PASSKEY_LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/passkey-login"),
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
 * The other way to finish that setup (#9764,
 * Common/Types/Accounts/SecondStepEnrolment): a security key. The options
 * for the browser's prompt, then the key's answer to them, which signs the
 * user in. Like the route above, both carry the email and password again
 * (or the sign-in link's token): there is no session until the key works.
 */
export const SECURITY_KEY_ENROLMENT_OPTIONS_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE));

export const VERIFY_SECURITY_KEY_ENROLMENT_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE));

/*
 * The options for a passkey the mobile app sets up in the phone's browser
 * (#9817), read once by the page it opened with the id the app was given.
 */
export const MOBILE_PASSKEY_ENROLMENT_OPTIONS_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route(MOBILE_PASSKEY_ENROLMENT_OPTIONS_ROUTE));

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

/*
 * The options for a security key's prompt at the second step (#9822,
 * Types/Accounts/SecurityKeySignIn). A sign-in route like the two around
 * it: the request carries the email and password again (or the sign-in
 * link's token), and only the account they prove gets its keys' options.
 */
export const GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route(SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE));

/*
 * Mints a set of recovery codes for the user who is ALREADY signed in.
 *
 * An APP_API_URL route rather than an identity one, and that is the whole
 * reason it can only be offered after the second step has completed: it is
 * authenticated by the session cookie the login just set, not by the email and
 * password the challenge routes re-submit. Offering it on the challenge screen
 * would mean handing recovery codes to whoever is holding the password, which
 * is exactly what a second factor exists to stop.
 */
export const GENERATE_BACKUP_CODES_API_URL: URL = URL.fromURL(
  APP_API_URL,
).addRoute(new Route("/user-two-factor-backup-code/generate"));

export const VERIFY_WEBAUTHN_AUTH_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/verify-webauthn-auth"));

export const SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/service-provider-login"));

export const SERVICE_PROVIDER_LOGIN_OIDC_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/service-provider-login-oidc"));

/*
 * How this server signs people in: whether it requires single sign-on, its
 * instance-wide providers, and - while SSO is required - whether a project
 * has a provider of its own to find by email (Common/Types/SSO/SignInMethods).
 * The sign-in, single sign-on and sign-up pages read it as they open.
 */
export const SIGN_IN_METHODS_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/sign-in-methods"),
);

/*
 * The providers that sign people in to one project - its own and the
 * instance-wide ones that reach it - for the page a project's SSO sign-in
 * link opens (Pages/LoginWithProjectSso, #9918). Asked by the project's id
 * alone: no address, so the answer says nothing about accounts.
 */
export const getProjectSignInMethodsApiUrl: (projectId: string) => URL = (
  projectId: string,
): URL => {
  return URL.fromURL(IDENTITY_URL).addRoute(
    new Route(getProjectSignInMethodsRoute(projectId)),
  );
};

export const GLOBAL_SSO_SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/global-sso/service-provider-login"));

export const GLOBAL_OIDC_SERVICE_PROVIDER_LOGIN_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/global-oidc/service-provider-login"));

export const FORGOT_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/forgot-password"),
);

/*
 * Emails a sign-in link to the address given (Common/Types/Accounts/
 * MagicLink). It answers the same whether or not that address has an
 * account, so the page that asks says "if".
 */
export const SEND_MAGIC_LINK_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/send-magic-link"),
);

/*
 * The first step of a sign-in begun with a sign-in link: the link's token in
 * place of the email and password. It answers as /login does - a session, or
 * the two factor challenge or enrolment, whose steps then carry the token
 * again where a password sign-in carries the password.
 */
export const MAGIC_LINK_LOGIN_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/login-with-magic-link"),
);

export const VERIFY_EMAIL_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/verify-email"),
);

export const RESET_PASSWORD_API_URL: URL = URL.fromURL(IDENTITY_URL).addRoute(
  new Route("/reset-password"),
);

/*
 * The public form routes: GET <this>/<shareKey> reads a form's questions and
 * POST <this>/<shareKey>/submit creates what the form is for from the
 * answers. Both are anonymous, and on APP_API_URL like the form's other
 * routes -- a signed-in visitor's session rides along, and the server ignores
 * it. Only the page's own client (FormAPI) may call them.
 */
export const FORM_PUBLIC_API_URL: URL = URL.fromURL(APP_API_URL).addRoute(
  new Route("/form/public"),
);

/*
 * Mails a fresh verification link to an account that signed up but has not
 * verified its address yet. There is no session at that point, so the request
 * is authorized by a credential instead: the short-lived resend token /signup
 * handed back, or a verification token from a link that stopped working. It
 * never takes an email address -- the link only ever goes to the address the
 * account already holds.
 */
export const RESEND_VERIFICATION_EMAIL_API_URL: URL = URL.fromURL(
  IDENTITY_URL,
).addRoute(new Route("/resend-verification-email"));

/*
 * The MCP consent screen's own calls (Pages/McpAuthorize): what an MCP client
 * is asking for, and the member's answer. They sit under /mcp/oauth beside
 * the rest of the MCP authorization server rather than under /api, and are
 * authenticated by the session cookie - which is why they are only ever
 * called from this page, on this origin. The origin is the API's own: the
 * same app serves both.
 */
const MCP_OAUTH_CONSENT_URL: URL = new URL(
  APP_API_URL.protocol,
  APP_API_URL.hostname,
  new Route("/mcp/oauth/consent"),
);

export const MCP_OAUTH_CONSENT_DETAILS_API_URL: URL = URL.fromURL(
  MCP_OAUTH_CONSENT_URL,
).addRoute(new Route("/details"));

export const MCP_OAUTH_CONSENT_APPROVE_API_URL: URL = URL.fromURL(
  MCP_OAUTH_CONSENT_URL,
).addRoute(new Route("/approve"));

export const MCP_OAUTH_CONSENT_DENY_API_URL: URL = URL.fromURL(
  MCP_OAUTH_CONSENT_URL,
).addRoute(new Route("/deny"));

/*
 * The marketplace purchase page's own calls (Pages/MarketplacePurchase): what
 * a purchase made on AWS, Microsoft or Google Cloud Marketplace is, and the
 * buyer's choice of project for it. The purchase's claim token travels in an
 * HttpOnly cookie that is sent with these calls and nothing else - its path is
 * /api/marketplace, so these must stay under the API's own route.
 */
export const MARKETPLACE_PURCHASE_DETAILS_API_URL: URL = URL.fromURL(
  APP_API_URL,
).addRoute(new Route("/marketplace/purchase/details"));

export const MARKETPLACE_PURCHASE_COMPLETE_API_URL: URL = URL.fromURL(
  APP_API_URL,
).addRoute(new Route("/marketplace/purchase/complete"));

export const MARKETPLACE_PURCHASE_DISMISS_API_URL: URL = URL.fromURL(
  APP_API_URL,
).addRoute(new Route("/marketplace/purchase/dismiss"));
