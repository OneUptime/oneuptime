import { PluralTemplate, translationKey } from "Common/Types/Translator";

/*
 * What Settings -> SSO says under Manage Sign-In with SSO, while it is on,
 * to the project's owners (#9820, ProjectSavedSignInSettings.tsx): how many
 * of the project's people still have a password or a second step saved in
 * OneUptime - counted only among people whose every project is one this
 * owner owns and that manages sign-in with SSO, the people the
 * organization alone is responsible for - and a button that clears them,
 * after a dialog that says it cannot be undone. Nothing shows to anybody
 * else, or while nobody has any.
 *
 * The same words as the Admin Dashboard's clear (SsoSettingsCopy's
 * SAVED_SIGN_IN_SETTINGS_COPY) where they mean the same thing: one name per
 * thing. The dialog's sentence fits a dialog's description (150
 * characters, ShortDescriptionsGuard). Kept free of React so the card and
 * the tests read these exact strings.
 */

export const PROJECT_SAVED_SIGN_IN_SETTINGS_COPY: {
  stillSaved: PluralTemplate;
  clearButton: string;
  confirmTitle: string;
  confirmDescription: string;
  cleared: PluralTemplate;
} = {
  stillSaved: {
    one: "{{count}} person whose projects are all yours still has a password or two-factor authentication saved in OneUptime.",
    other:
      "{{count}} people whose projects are all yours still have a password or two-factor authentication saved in OneUptime.",
  },
  clearButton: translationKey("Clear Sign-In Settings"),
  confirmTitle: translationKey("Clear their saved sign-in settings?"),
  confirmDescription: translationKey(
    "Their passwords, passkeys, security keys, authenticator apps and backup codes are deleted, and each is emailed. This cannot be undone.",
  ),
  cleared: {
    one: "Cleared the sign-in settings of {{count}} person.",
    other: "Cleared the sign-in settings of {{count}} people.",
  },
};

// The data-testid of the row; its parts add -count, -clear.
export const PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID: string =
  "project-saved-sign-in-settings";

export default PROJECT_SAVED_SIGN_IN_SETTINGS_COPY;
