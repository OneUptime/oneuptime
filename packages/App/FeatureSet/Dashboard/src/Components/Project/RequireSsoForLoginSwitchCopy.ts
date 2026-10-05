import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether everyone has to sign in with SSO to open the project, on Settings
 * -> SSO, under the providers and the link that tests them.
 *
 * It used to be an "SSO Settings" card ("Configure settings for SSO.")
 * whose Edit Settings dialog held one switch, "Force SSO for Login", with a
 * warning to test SSO first ("Please test SSO before you you enable this
 * feature."). The card is the switch now (RequireSsoForLoginCard, on the
 * shared ModelSwitchCard), named "Require SSO for Login" as the docs and the
 * admin dashboard's instance-wide switch name it, and it saves the moment it
 * is flipped.
 *
 * Requiring SSO asks first, with a red button: from then on everyone in the
 * project - the person flipping it, project owners and master admins
 * included - is refused the project until they sign in with SSO
 * (UserMiddleware.getUserTenantAccessPermissionWithTenantId), so an untested
 * provider locks the whole project out. Turning the requirement off saves at
 * once: it locks nobody out.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const RequireSsoForLoginSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // The dialog before SSO is required.
  requireConfirmTitle: string;
  requireConfirmDescription: string;
  requireConfirmButton: string;
} = {
  cardTitle: translationKey("SSO Settings"),
  cardDescription: translationKey(
    "Test SSO with the link above before you require it.",
  ),
  switchTitle: translationKey("Require SSO for Login"),
  switchOnDescription: translationKey(
    "Everyone has to sign in with SSO to open this project. Signing in with a password is not enough.",
  ),
  switchOffDescription: translationKey(
    "Members can open this project after signing in with a password or with SSO.",
  ),
  requireConfirmTitle: translationKey("Require SSO for this project?"),
  requireConfirmDescription: translationKey(
    "Everyone in this project, you included, will have to sign in with SSO to open it. Anyone signed in with a password is locked out of the project until they sign in with SSO, so test SSO with the link above first.",
  ),
  requireConfirmButton: translationKey("Require SSO"),
};

// The Project column the switch writes.
export type RequireSsoForLoginSwitchColumn = "requireSsoForLogin";

export const REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN: RequireSsoForLoginSwitchColumn =
  "requireSsoForLogin";

// The data-testid of the switch.
export const REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID: string =
  "project-require-sso-switch";

export default RequireSsoForLoginSwitchCopy;
