/*
 * HOW A DASHBOARD'S PUBLIC LINK SIGNS ITS PRIVATE USERS IN (#10250).
 *
 * A dashboard whose Sharing choice is Only people who sign in
 * (Types/Dashboard/DashboardAccess) shows a sign-in page on its public link
 * - OneUptime's own address and every custom domain of the dashboard - and
 * the public dashboard app signs its visitors in through these routes, on
 * the host it is served from, under the link's API (/public-dashboard-api,
 * which every host passes to the app). The identity service serves them
 * (App/FeatureSet/Identity/API/DashboardPrivateUserAuthentication).
 *
 * Single sign-on starts and ends on OneUptime's own address, where the
 * identity providers are configured (App/FeatureSet/Identity/API/
 * DashboardSSO, DashboardOIDC): it sends the visitor back to the
 * dashboard's public link with a code good for five minutes in the address
 * (DASHBOARD_LOGIN_CODE_PARAMETER), which the page exchanges for its
 * session on its own host.
 *
 * Kept free of anything server-side, so the server, the public dashboard
 * app and the suites read the same routes and the same words.
 */

// Where the routes are, under the public link's API.
export const DASHBOARD_PRIVATE_USER_API_ROUTE: string = "/private-user";

// Each route, after DASHBOARD_PRIVATE_USER_API_ROUTE; the dashboard's id follows.
export const DashboardPrivateUserApiRoutes: {
  login: string;
  logout: string;
  refreshToken: string;
  forgotPassword: string;
  resetPassword: string;
  exchangeLoginCode: string;
  signInMethods: string;
} = {
  login: "/login",
  logout: "/logout",
  refreshToken: "/refresh-token",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  exchangeLoginCode: "/exchange-login-code",
  signInMethods: "/sign-in-methods",
};

// The address parameter single sign-on hands the dashboard's page its code in.
export const DASHBOARD_LOGIN_CODE_PARAMETER: string = "loginCode";

/*
 * The one answer to a password sign-in that does not sign anybody in: a
 * wrong password, an address that is no private user of the dashboard, and
 * one invited who has not chosen a password yet all read alike, after as
 * long as a password check takes, so the page says nothing about who is
 * invited.
 */
export const DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE: string =
  "That email and password do not match. Try again, or use Forgot password to choose a new password.";

// A route of the sign-in, on a dashboard whose link does not ask for one.
export const DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE: string =
  "This dashboard does not ask its visitors to sign in. Open its link to view it.";

// A password, on a dashboard that requires single sign-on.
export const DASHBOARD_SSO_ONLY_MESSAGE: string =
  "This dashboard signs its visitors in with single sign-on only. Use Sign in with SSO.";

// A single sign-on code that cannot be exchanged, whatever the reason.
export const DASHBOARD_SIGN_IN_CODE_INVALID_MESSAGE: string =
  "This sign-in link is not valid or has expired. Sign in again.";

// The session behind a refresh has ended, or is not this dashboard's.
export const DASHBOARD_SESSION_EXPIRED_MESSAGE: string =
  "Your session has ended. Sign in again.";

// A refresh from a browser that holds no session of the dashboard at all.
export const DASHBOARD_SIGNED_OUT_MESSAGE: string =
  "You are signed out. Sign in to view this dashboard.";

/*
 * What the public dashboard app reads to draw the sign-in page
 * (DashboardPrivateUserApiRoutes.signInMethods): whether a password signs
 * in, and the single sign-on providers that are on - their names and what
 * each is for, which the team wrote for the visitors to choose by. Nothing
 * else of the providers, and nothing of the private users.
 */
export interface DashboardSignInProvider {
  // The provider's id: the address that starts its sign-in names it.
  _id: string;
  name: string;
  description: string;
}

export interface DashboardSignInMethods {
  isPasswordSignInAllowed: boolean;
  samlProviders: Array<DashboardSignInProvider>;
  oidcProviders: Array<DashboardSignInProvider>;
}
