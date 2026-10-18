import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * STATUS PAGES -> A PAGE -> SECURITY -> SSO AND OIDC.
 *
 * The SSO list said, as its description and in its empty state, "Single
 * sign-on is an authentication scheme that allows a user to log in with a
 * single ID to any of several related, yet independent, software systems." -
 * a dictionary entry, not what the list is for - and "No SSO configuration
 * found.", the words of a search that missed. Under it, whether there was a
 * provider to test or not, a card said "Here's a link which will help you
 * test SSO integration before you force it on your organization: <the link
 * in grey>". The OIDC page said the same in its own words.
 *
 * Now each list says what its providers do for the page, an empty one says
 * "No SSO providers yet" with Add SSO Provider, and the test link card - the
 * link drawn as one - shows once there is a provider to test.
 *
 * The project's own SSO and OIDC pages (Settings) keep their words: they are
 * another audit's.
 *
 * Kept free of React so the pages and App/Tests read these exact strings.
 */

export const STATUS_PAGE_SIGN_IN_TEST_CARD_TEST_ID: string =
  "status-page-sign-in-test";

export const StatusPageSignInCopy: {
  ssoDescription: string;
  ssoProvider: string;
  ssoProviders: string;
  addSsoProvider: string;
  addNewSsoProvider: string;
  oidcDescription: string;
  oidcProvider: string;
  oidcProviders: string;
  addOidcProvider: string;
  addNewOidcProvider: string;
  testTitle: string;
  testSentence: string;
} = {
  ssoDescription: translationKey(
    "Private users sign in with your SAML identity provider, such as Okta or Microsoft Entra ID.",
  ),
  ssoProvider: translationKey("SSO Provider"),
  ssoProviders: translationKey("SSO Providers"),
  addSsoProvider: translationKey("Add SSO Provider"),
  addNewSsoProvider: translationKey("Add New SSO Provider"),
  oidcDescription: translationKey(
    "Private users sign in with your OpenID Connect provider, such as Google or Okta.",
  ),
  oidcProvider: translationKey("OIDC Provider"),
  oidcProviders: translationKey("OIDC Providers"),
  addOidcProvider: translationKey("Add OIDC Provider"),
  addNewOidcProvider: translationKey("Add New OIDC Provider"),
  testTitle: translationKey("Test Sign-In"),
  testSentence: translationKey(
    "Check that signing in works before you require it: {{link}}",
  ),
};

export default StatusPageSignInCopy;
