import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the pages a public link's sign-in is set up on - a
 * dashboard's Private Users and Single Sign-On (#10250), a form's next -
 * the same for every kind (PrivateAccessKinds). Where a status page's pages
 * say the same thing, they say it in the same words, so a person who set up
 * one reads the other the same way, in every language.
 *
 * Kept free of React so the components and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it.
 */
const PrivateAccessCopy: {
  privateUser: string;
  privateUsers: string;
  privateUsersTitle: string;
  emailTitle: string;
  statusTitle: string;
  // A private user who set a password or signed in at least once.
  joined: string;
  // One who has only been sent their invitation.
  invited: string;
  lastSignedIn: string;
  singleSignOn: string;
  samlTabName: string;
  oidcTabName: string;
  samlCardTitle: string;
  oidcCardTitle: string;
  ssoProvider: string;
  ssoProviders: string;
  oidcProvider: string;
  oidcProviders: string;
  viewSamlConfig: string;
  viewOidcConfig: string;
  samlConfigTitle: string;
  oidcConfigTitle: string;
  samlEntityIdLabel: string;
  samlReplyUrlLabel: string;
  oidcRedirectUriLabel: string;
  oidcRedirectHint: string;
  samlTurnOnNote: string;
  oidcTurnOnNote: string;
  close: string;
  requireSsoCardTitle: string;
  requireSsoSwitchTitle: string;
  requireSsoOnDescription: string;
  requireSsoOffDescription: string;
  requireSsoConfirmTitle: string;
  requireSsoConfirmButton: string;
} = {
  privateUser: translationKey("Private User"),
  privateUsers: translationKey("Private Users"),
  privateUsersTitle: translationKey("Private Users"),
  emailTitle: translationKey("Email"),
  statusTitle: translationKey("Status"),
  joined: translationKey("Signed up"),
  invited: translationKey("Invite Sent"),
  lastSignedIn: translationKey("Last Signed In"),
  singleSignOn: translationKey("Single Sign-On"),
  samlTabName: translationKey("SAML"),
  oidcTabName: translationKey("OIDC"),
  samlCardTitle: translationKey("Single Sign On (SSO)"),
  oidcCardTitle: translationKey("OpenID Connect (OIDC)"),
  ssoProvider: translationKey("SSO Provider"),
  ssoProviders: translationKey("SSO Providers"),
  oidcProvider: translationKey("OIDC Provider"),
  oidcProviders: translationKey("OIDC Providers"),
  viewSamlConfig: translationKey("View SSO Config"),
  viewOidcConfig: translationKey("View OIDC Config"),
  samlConfigTitle: translationKey("SSO Configuration"),
  oidcConfigTitle: translationKey("OIDC Configuration"),
  samlEntityIdLabel: translationKey("Identifier (Entity ID):"),
  samlReplyUrlLabel: translationKey(
    "Reply URL (Assertion Consumer Service URL):",
  ),
  oidcRedirectUriLabel: translationKey("Redirect URI (Callback URL):"),
  oidcRedirectHint: translationKey(
    "Configure your identity provider to redirect to the URL above after authentication. The client must be permitted to use the authorization code flow with PKCE.",
  ),
  samlTurnOnNote: translationKey(
    "This provider is off. Once your identity provider has the Entity ID and Reply URL above, edit the provider and turn Enabled on.",
  ),
  oidcTurnOnNote: translationKey(
    "This provider is off. Once your identity provider has the redirect URI above, edit the provider and turn Enabled on.",
  ),
  close: translationKey("Close"),
  requireSsoCardTitle: translationKey("SSO Settings"),
  requireSsoSwitchTitle: translationKey("Require SSO to Sign In"),
  requireSsoOnDescription: translationKey(
    "Private users sign in with SSO or OIDC only. Signing in with an email and password is turned off.",
  ),
  requireSsoOffDescription: translationKey(
    "Private users can sign in with an email and password, or with SSO or OIDC.",
  ),
  requireSsoConfirmTitle: translationKey("Require SSO to sign in?"),
  requireSsoConfirmButton: translationKey("Require SSO"),
};

// Test ids.
export const PRIVATE_USERS_TABLE_TEST_ID: string = "private-users-table";
export const SINGLE_SIGN_ON_TABS_TEST_ID: string = "single-sign-on-tabs";
export const SAML_CONFIG_VALUES_TEST_ID: string = "sso-config-values";
export const OIDC_CONFIG_VALUES_TEST_ID: string = "oidc-config-values";
export const REQUIRE_SSO_SWITCH_TEST_ID: string = "require-sso-switch";

/*
 * Whether a private user has joined: they set a password, or they have
 * signed in at least once - with single sign-on, which needs none. Somebody
 * who has done neither has only been sent their invitation.
 */
export const hasPrivateUserJoined: (user: {
  hasPassword?: boolean | undefined;
  lastActive?: Date | undefined;
}) => boolean = (user: {
  hasPassword?: boolean | undefined;
  lastActive?: Date | undefined;
}): boolean => {
  return Boolean(user.hasPassword) || Boolean(user.lastActive);
};

export default PrivateAccessCopy;
