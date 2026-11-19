import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether the project manages its people's sign-in with SSO (#9763,
 * Common/Types/SSO/SsoManagedSignIn), on Settings -> SSO: a switch under
 * Require SSO to Sign In, drawn only while the project requires SSO -
 * with it off, this one would change nothing.
 *
 * On, someone whose every project requires SSO and has this on sets no
 * password, passkey, security key, authenticator app, backup codes or
 * two-factor authentication in OneUptime: their User Profile names the
 * identity provider instead, and the server refuses them those settings.
 * One project of theirs that does not - another organization's, one they
 * are invited to - keeps their settings theirs, so the switch never decides
 * for an account that belongs to someone else's projects too. Master admins
 * keep their own. It deletes nothing, and turning it off gives the settings
 * back at once, so it saves without asking. Changed by whoever may require
 * SSO for the project, on the plans that may.
 *
 * Kept free of React so the card and the tests read these exact strings.
 */

export const ManageSignInWithSsoSwitchCopy: {
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
} = {
  switchTitle: translationKey("Manage Sign-In with SSO"),
  switchOnDescription: translationKey(
    "People whose every project requires SSO and has this on get no password, passkeys or two-factor authentication in OneUptime.",
  ),
  switchOffDescription: translationKey(
    "Members keep their own password, passkeys and two-factor authentication in OneUptime.",
  ),
};

// The Project column the switch writes.
export type ManageSignInWithSsoSwitchColumn = "manageSignInWithSso";

export const MANAGE_SIGN_IN_WITH_SSO_SWITCH_COLUMN: ManageSignInWithSsoSwitchColumn =
  "manageSignInWithSso";

// The data-testid of the switch.
export const MANAGE_SIGN_IN_WITH_SSO_SWITCH_TEST_ID: string =
  "project-manage-sign-in-with-sso-switch";

export default ManageSignInWithSsoSwitchCopy;
