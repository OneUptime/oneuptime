/*
 * What Settings > Authentication's switches are called, kept free of React
 * so App/Tests can read them (see Index.tsx for the switches themselves).
 *
 * The Sign Up, Sign-In Links and Project Creation cards read the page's own
 * locale keys, pages.settings.authentication.*. Require SSO for Login lives
 * on Settings > Single Sign-On now, beside the providers it depends on
 * (../SSO/SsoSettingsCopy).
 */

// The switches' data-testids.
export const SIGN_UP_SWITCH_TEST_ID: string = "admin-sign-up-switch";
export const PROJECT_CREATION_SWITCH_TEST_ID: string =
  "admin-project-creation-switch";
export const MAGIC_LINK_SWITCH_TEST_ID: string = "admin-magic-link-switch";
// The line under Sign Up while the server requires SSO.
export const SIGN_UP_SSO_REQUIRED_TEST_ID: string =
  "admin-sign-up-sso-required";
// The line under Sign-In Links while the server requires SSO.
export const MAGIC_LINK_SSO_REQUIRED_TEST_ID: string =
  "admin-magic-link-sso-required";
