/*
 * What Settings > Single Sign-On says, kept free of React so App/Tests can
 * read these exact strings (see Index.tsx for the page).
 *
 * The page's strings are looked up by their English text, as the shared
 * components look theirs up: each one is a key of the Admin Dashboard's
 * locale files, translated in every language
 * (App/Tests/AdminDashboard/SsoAndHealthLicenseLocales, and
 * Common/Tests/App/AdminDashboard/AdminRequireSsoCardLocales, which renders
 * the card in each one). The side menu entry and the breadcrumb read the
 * page's own keys, sideMenu.settingsSso and breadcrumbs.singleSignOn.
 */

export const SSO_PAGE_COPY: {
  // The line at the top of the page, with a link to the docs.
  bannerTitle: string;
  bannerDescription: string;
  samlCardTitle: string;
  samlCardDescription: string;
  samlProvider: string;
  samlProviders: string;
  oidcCardTitle: string;
  oidcCardDescription: string;
  oidcProvider: string;
  oidcProviders: string;
  // A row's action that starts a sign-in with the provider, in a new tab.
  testSignIn: string;
} = {
  bannerTitle: "Single sign-on for this server",
  bannerDescription:
    "These providers sign people in to every project on this server they belong to. Attach projects to a provider to add newcomers to their teams.",
  samlCardTitle: "SAML",
  samlCardDescription:
    "Sign in through a SAML app, such as Okta, Microsoft Entra ID or OneLogin.",
  samlProvider: "SAML Provider",
  samlProviders: "SAML Providers",
  oidcCardTitle: "OpenID Connect (OIDC)",
  oidcCardDescription:
    "Sign in through an OpenID Connect app, such as Google Workspace, Auth0 or Keycloak.",
  oidcProvider: "OIDC Provider",
  oidcProviders: "OIDC Providers",
  testSignIn: "Test Sign-in",
};

export const REQUIRE_SSO_COPY: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch, for the way it is set.
  switchOnDescription: string;
  switchOffDescription: string;
  // Under the switch, whichever way it is set: the master admins' way in.
  masterAdminSentence: string;
  masterAdminAddressLabel: string;
  /*
   * The dialog before SSO is required for everyone: its sentence fits a
   * dialog's description (at most 150 characters, ShortDescriptionsGuard);
   * the card's line above the switch says to test a provider first.
   */
  confirmTitle: string;
  confirmDescription: string;
  confirmButton: string;
} = {
  cardTitle: "Require SSO",
  cardDescription:
    "Before you require SSO, sign in with a provider using Test Sign-in in its row.",
  switchTitle: "Require SSO for Login",
  switchOnDescription:
    "The sign-in page offers only SSO. Everyone except master admins must sign in with SSO to open any project.",
  switchOffDescription: "People can sign in with a password, a passkey or SSO.",
  masterAdminSentence:
    "Master admins can always sign in with their password here, even while SSO is required. Keep this address.",
  masterAdminAddressLabel: "Master admin sign-in",
  confirmTitle: "Require SSO for everyone?",
  confirmDescription:
    "The sign-in page will offer only SSO. Everyone except master admins, including people signed in now, must sign in with SSO to open any project.",
  confirmButton: "Require SSO",
};

/*
 * The Sign Up card on Settings > Authentication, while the server requires
 * SSO: nobody signs up then, whatever its switch says (SsoRequiredSignIn).
 */
export const SIGN_UP_WHILE_SSO_REQUIRED: string =
  "While SSO is required, people get their account by signing in with SSO or by an invitation, not by signing up.";

// The switch's data-testid, and the details under it.
export const REQUIRE_SSO_SWITCH_TEST_ID: string = "admin-require-sso-switch";
export const MASTER_ADMIN_SIGN_IN_TEST_ID: string =
  "admin-master-admin-sign-in";
export const SAML_PROVIDERS_TABLE_ID: string = "global-sso-table";
export const OIDC_PROVIDERS_TABLE_ID: string = "global-oidc-table";
