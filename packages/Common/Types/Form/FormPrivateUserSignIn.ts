import {
  DashboardPrivateUserApiRoutes,
  DashboardSignInMethods,
  DashboardSignInProvider,
} from "../Dashboard/DashboardPrivateUserSignIn";

/*
 * HOW A FORM'S PUBLIC LINK SIGNS ITS PRIVATE USERS IN (#10249).
 *
 * A form set to Only people who sign in (Form.requireSignIn) shows a
 * sign-in page on its public link - OneUptime's own address
 * (/accounts/form/<share key>) and every custom domain of the form - and
 * is neither shown nor taken from anyone else. Its page signs its visitors
 * in through these routes, on the host it is served from, under the form's
 * API (/api/form): the identity service serves them (App/FeatureSet/
 * Identity/API/FormPrivateUserAuthentication), as a dashboard's are (#10250).
 *
 * The page knows its form by its share key, or by the custom domain it is
 * on, and never by its id - so it reads the sign-in state first
 * (FORM_SIGN_IN_STATE_ROUTE), which gives the id the sign-in routes take,
 * on a form that asks its visitors to sign in and only there.
 *
 * Single sign-on starts and ends on OneUptime's own address, where the
 * identity providers are configured (Identity/API/FormSSO, FormOIDC): it
 * sends the visitor back to the form's public link with a code good for
 * five minutes in the address (FORM_LOGIN_CODE_PARAMETER), which the page
 * exchanges for its session on its own host.
 *
 * Kept free of anything server-side, so the server, the form's page and
 * the suites read the same routes and the same words.
 */

// Where the routes are, under the form's API.
export const FORM_PRIVATE_USER_API_ROUTE: string = "/private-user";

// Each route, after FORM_PRIVATE_USER_API_ROUTE; the form's id follows.
export const FormPrivateUserApiRoutes: typeof DashboardPrivateUserApiRoutes = {
  ...DashboardPrivateUserApiRoutes,
};

/*
 * The sign-in state of the form a page is on, after the form's public route
 * (/public/<share key>) or its custom-domain route (/custom-domain).
 */
export const FORM_SIGN_IN_STATE_ROUTE: string = "/sign-in-state";

// The address parameter single sign-on hands the form's page its code in.
export const FORM_LOGIN_CODE_PARAMETER: string = "loginCode";

/*
 * What a form's page reads before anything else (FORM_SIGN_IN_STATE_ROUTE):
 * whether the form asks its visitors to sign in, and only when it does,
 * its id - which the sign-in routes take - its name, for the sign-in page's
 * title, and the address of the private user signed in on this host, if
 * one is. Nothing else of the form before somebody has signed in.
 */
export interface FormSignInState {
  requireSignIn: boolean;
  formId?: string | undefined;
  name?: string | undefined;
  signedInAs?: string | null | undefined;
}

/*
 * The answer every route of the form gives a visitor of a form that asks
 * its visitors to sign in, until one of its private users has.
 */
export const FORM_SIGN_IN_REQUIRED_MESSAGE: string =
  "Sign in to open this form.";

/*
 * The one answer to a password sign-in that does not sign anybody in: a
 * wrong password, an address that is no private user of the form, and one
 * invited who has not chosen a password yet all read alike, after as long
 * as a password check takes, so the page says nothing about who is
 * invited.
 */
export const FORM_PRIVATE_USER_CREDENTIALS_MESSAGE: string =
  "That email and password do not match. Try again, or use Forgot password to choose a new password.";

// A route of the sign-in, on a form whose link does not ask for one.
export const FORM_SIGN_IN_NOT_ASKED_MESSAGE: string =
  "This form does not ask its visitors to sign in. Open its link to fill it in.";

// A password, on a form that requires single sign-on.
export const FORM_SSO_ONLY_MESSAGE: string =
  "This form signs its visitors in with single sign-on only. Use Sign in with SSO.";

// A single sign-on code that cannot be exchanged, whatever the reason.
export const FORM_SIGN_IN_CODE_INVALID_MESSAGE: string =
  "This sign-in link is not valid or has expired. Sign in again.";

// The session behind a refresh has ended, or is not this form's.
export const FORM_SESSION_EXPIRED_MESSAGE: string =
  "Your session has ended. Sign in again.";

// A refresh from a browser that holds no session of the form at all.
export const FORM_SIGNED_OUT_MESSAGE: string =
  "You are signed out. Sign in to open this form.";

/*
 * What a form's sign-in page reads to draw itself
 * (FormPrivateUserApiRoutes.signInMethods): whether a password signs in,
 * and the single sign-on providers that are on - their names and what each
 * is for. The same as a dashboard's.
 */
export type FormSignInProvider = DashboardSignInProvider;
export type FormSignInMethods = DashboardSignInMethods;
