import { PluralTemplate, translationKey } from "Common/Types/Translator";

/*
 * What the project's Users list says of a member whose saved sign-in
 * settings its owner may clear (#9993, MemberSavedSignInSettings.tsx): a
 * chip beside Member, and Clear Sign-In Settings in the row's menu, behind
 * a question that names the person and lists exactly what goes. Shown only
 * to the project's owners, and only for the members the server names -
 * people whose every project is one this owner owns that manages sign-in
 * with SSO, never a master admin, never the owner themselves.
 *
 * The same words as the Require SSO card's clear of everyone
 * (ProjectSavedSignInSettingsCopy) and the email's list of what was
 * removed (Common/Types/SSO/SignInSettingsClearedEmail) where they mean the
 * same thing: one name per thing. Kept free of React so the page and the
 * tests read these exact strings.
 */

export const MEMBER_SAVED_SIGN_IN_SETTINGS_COPY: {
  pill: string;
  pillTooltip: string;
  action: string;
  confirmTitle: string;
  confirmTitleWithoutName: string;
  confirmDescription: string;
  password: string;
  passwordResetLink: string;
  passkeys: PluralTemplate;
  authenticatorApps: PluralTemplate;
  backupCodes: PluralTemplate;
  twoFactorAuth: string;
  cleared: string;
  clearedWithoutName: string;
} = {
  // The chip beside Member, and what it means on hover.
  pill: translationKey("Sign-In Settings Saved"),
  pillTooltip: translationKey(
    "Still has a password or two-factor authentication saved in OneUptime, which their projects don't use.",
  ),
  // The row's action, the question's button: the Require SSO card's words.
  action: translationKey("Clear Sign-In Settings"),
  confirmTitle: translationKey("Clear {{name}}'s saved sign-in settings?"),
  // A row with no name or address to say (the bulk clear's own question).
  confirmTitleWithoutName: translationKey(
    "Clear their saved sign-in settings?",
  ),
  confirmDescription: translationKey(
    "This deletes the sign-in settings below, signs out their devices not signed in with SSO, and emails them. It can't be undone.",
  ),
  // What goes, one line each, as the email lists it.
  password: translationKey(
    "Their password, and any password reset or sign-in link",
  ),
  passwordResetLink: translationKey("A password reset link that still works"),
  passkeys: {
    one: "{{count}} passkey or security key",
    other: "{{count}} passkeys and security keys",
  },
  authenticatorApps: {
    one: "{{count}} authenticator app",
    other: "{{count}} authenticator apps",
  },
  backupCodes: {
    one: "{{count}} backup code",
    other: "{{count}} backup codes",
  },
  twoFactorAuth: translationKey(
    "Two-factor authentication, which is turned off",
  ),
  // Said once the server has cleared them.
  cleared: translationKey("Cleared {{name}}'s sign-in settings."),
  clearedWithoutName: translationKey("Cleared their sign-in settings."),
};

// The data-testids of the chip, the question's list and the success toast.
export const MEMBER_SAVED_SIGN_IN_SETTINGS_PILL_TEST_ID: string =
  "member-saved-sign-in-settings";

export const MEMBER_SAVED_SIGN_IN_SETTINGS_LIST_TEST_ID: string =
  "member-saved-sign-in-settings-removed";

export const MEMBER_SAVED_SIGN_IN_SETTINGS_CLEARED_TOAST_TEST_ID: string =
  "member-saved-sign-in-settings-cleared";

export default MEMBER_SAVED_SIGN_IN_SETTINGS_COPY;
