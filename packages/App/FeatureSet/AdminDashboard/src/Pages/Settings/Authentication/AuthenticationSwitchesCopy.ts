/*
 * What Settings > Authentication's switches say and are called, kept free of
 * React so App/Tests can read these exact strings (see Index.tsx for the
 * switches themselves).
 *
 * The "Single Sign-On (SSO)" card's strings are looked up by their English
 * text, as the shared components look theirs up: each one is a key of the
 * Admin Dashboard's locale files (App/Tests/AdminDashboard/
 * SsoAndHealthLicenseLocales keeps them translated in every language). The
 * Sign Up and Project Creation cards read the page's own locale keys,
 * pages.settings.authentication.*.
 */

export const REQUIRE_SSO_COPY: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch, whichever way it is set: GlobalConfig's description.
  note: string;
  // The dialog before SSO is required for everyone.
  confirmTitle: string;
  confirmDescription: string;
  confirmButton: string;
} = {
  cardTitle: "Single Sign-On (SSO)",
  cardDescription:
    "Control whether users must sign in with SSO across this server.",
  switchTitle: "Require SSO for Login",
  note: "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.",
  confirmTitle: "Require SSO for everyone?",
  confirmDescription:
    "Everyone except master admins will have to sign in with SSO to open any project on this server. Anyone who signs in with a password is locked out of their projects until they sign in with SSO, so check that an SSO provider works for them first.",
  confirmButton: "Require SSO",
};

// The switches' data-testids.
export const SIGN_UP_SWITCH_TEST_ID: string = "admin-sign-up-switch";
export const REQUIRE_SSO_SWITCH_TEST_ID: string = "admin-require-sso-switch";
export const PROJECT_CREATION_SWITCH_TEST_ID: string =
  "admin-project-creation-switch";
