import { JSONObject } from "../JSON";

/*
 * CLEARING THE SIGN-IN SETTINGS PEOPLE SAVED IN ONEUPTIME (issue #9762).
 *
 * While single sign-on manages someone's sign-in (Types/SSO/SsoManagedSignIn),
 * OneUptime refuses them a new password, passkey, security key, authenticator
 * app, backup codes or two-factor authentication - but keeps what they saved
 * before: it signs nobody in while the requirement is on, and works again if
 * it is turned off. #9726 deleted nothing on purpose: removing credentials on
 * upgrade, or as a side effect of flipping a switch, cannot be undone.
 *
 * A master admin can clear them when they decide to, in the Admin Dashboard
 * (and an organization can clear its own people's, below: #9820). Each
 * person cleared is emailed what was removed and how they sign in now
 * (#9818, Types/SSO/SignInSettingsClearedEmail):
 *
 *   - for one person, on the user's Authentication page (Clear Sign-In
 *     Settings): POST /user/:userId/clear-local-sign-in. Never their own
 *     account - their own settings are in User Profile, and clearing them
 *     here could leave a server that requires SSO with no master admin who
 *     can sign in with a password. A master admin's is cleared only when the
 *     request says so for that person (isMasterAdminConfirmed), after the
 *     dialog names them as one;
 *   - for everyone the server's requirement covers, on the Require SSO card
 *     while it is on: GET /global-config/saved-sign-in-settings counts the
 *     people - never master admins - who still have any, and POST
 *     /global-config/saved-sign-in-settings/clear clears all of theirs.
 *     Refused while the server does not require SSO: these settings still
 *     sign people in then. Master admins are never among them, whatever
 *     they are when the clear reaches them.
 *
 * WHAT IS CLEARED: the password, with any password reset link or sign-in
 * link already sent; every passkey and security key; every authenticator
 * app, set up or not; every backup code; and two-factor authentication,
 * turned off - with nothing behind it, it would only send them through
 * setting up a second step again. The sessions they signed in to without
 * single sign-on end, since what they were signed in with is gone; a
 * session signed in with SSO stays. Each person cleared gets an entry in
 * the audit log of every project they are a member of: an Update of the
 * User, by the master admin, naming what was removed
 * (Types/AuditLog/AuditLogSignInSettingsCleared).
 *
 * It cannot be undone, and it locks nobody out: someone who needs a
 * password again - the server stopped requiring SSO - sets one with Forgot
 * password? (an account with no password is mailed the link to set its
 * first), as for an account made by an invitation.
 */

// POST /user/:userId/<this>, under the API's address (APP_API_URL).
export const CLEAR_LOCAL_SIGN_IN_ACTION: string = "clear-local-sign-in";

// The Require SSO card's count, and its clear, under the API's address.
export const SAVED_SIGN_IN_SETTINGS_ROUTE: string =
  "/global-config/saved-sign-in-settings";

export const CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE: string =
  "/global-config/saved-sign-in-settings/clear";

/*
 * AN ORGANIZATION'S OWN CLEAR (#9820). A project that requires SSO and
 * manages its people's sign-in with it (Project.manageSignInWithSso) can
 * clear what its people saved before, from Project Settings > Security >
 * SSO - but only for people whose every project, an invitation not yet
 * accepted included, manages sign-in with SSO and is one the clearing
 * person owns: "the same organization" is the projects an owner owns
 * (Server/Utils/ProjectSignInClearing says why, and what else it holds
 * to). Under the API's address, the project's id in the path:
 *
 *   GET  /project/:projectId/saved-sign-in-settings        - how many
 *   POST /project/:projectId/saved-sign-in-settings/clear  - clear them
 *
 * Answered as the server's own are: SavedSignInSettingsAnswer and
 * ClearSavedSignInSettingsAnswer below.
 */
export const PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION: string =
  "saved-sign-in-settings";

export const PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION: string =
  "saved-sign-in-settings/clear";

// The two routes for one project, under the API's address.
export const getProjectSavedSignInSettingsRoute: (
  projectId: string,
) => string = (projectId: string): string => {
  return `/project/${projectId}/${PROJECT_SAVED_SIGN_IN_SETTINGS_ACTION}`;
};

export const getProjectClearSavedSignInSettingsRoute: (
  projectId: string,
) => string = (projectId: string): string => {
  return `/project/${projectId}/${PROJECT_CLEAR_SAVED_SIGN_IN_SETTINGS_ACTION}`;
};

export const CLEAR_PROJECT_SIGN_IN_NEEDS_MANAGED_SSO_MESSAGE: string =
  "This project does not manage its people's sign-in with SSO, so their passwords and second steps still sign them in. Turn on Require SSO to Sign In and Manage Sign-In with SSO first.";

export const CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE: string =
  "Only Project Owners can clear the sign-in settings this project's people saved.";

// What one person has saved in OneUptime to sign in with.
export interface LocalSignInSettings {
  hasPassword: boolean;
  isTwoFactorAuthEnabled: boolean;
  // Set up or not: each holds a secret.
  authenticatorAppCount: number;
  passkeyAndSecurityKeyCount: number;
  // The ones not spent yet.
  backupCodeCount: number;
}

// What POST /user/:userId/clear-local-sign-in answers: what it removed.
export interface ClearLocalSignInAnswer {
  cleared: LocalSignInSettings;
  // The sessions it ended: those not signed in with single sign-on.
  sessionsEnded: number;
}

// What GET /global-config/saved-sign-in-settings answers.
export interface SavedSignInSettingsAnswer {
  /*
   * How many people the server's requirement covers - everyone but master
   * admins - still have a password, passkey, security key, authenticator
   * app, backup code, two-factor authentication or a password reset link.
   */
  peopleCount: number;
}

// What POST /global-config/saved-sign-in-settings/clear answers.
export interface ClearSavedSignInSettingsAnswer {
  peopleCleared: number;
}

export const CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE: string =
  "Single sign-on is not required, so these passwords and second steps still sign people in. Turn on Require SSO to Sign In first.";

export const CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE: string =
  "This person is a master admin. Confirm that you mean to clear a master admin's sign-in settings, then try again.";

export const CLEAR_OWN_SIGN_IN_MESSAGE: string =
  "You cannot clear your own sign-in settings here. Change them in User Profile, under Security.";

// Nothing saved: the person has nothing to clear.
export const NO_LOCAL_SIGN_IN_SETTINGS: LocalSignInSettings = {
  hasPassword: false,
  isTwoFactorAuthEnabled: false,
  authenticatorAppCount: 0,
  passkeyAndSecurityKeyCount: 0,
  backupCodeCount: 0,
};

// Whether a person has anything saved to clear.
export const hasLocalSignInSettings: (
  settings: LocalSignInSettings,
) => boolean = (settings: LocalSignInSettings): boolean => {
  return (
    settings.hasPassword ||
    settings.isTwoFactorAuthEnabled ||
    settings.authenticatorAppCount > 0 ||
    settings.passkeyAndSecurityKeyCount > 0 ||
    settings.backupCodeCount > 0
  );
};

const readCount: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

const readObject: (value: unknown) => JSONObject | null = (
  value: unknown,
): JSONObject | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
};

// What a person had, as an answer carries it, or null for anything else.
export const readLocalSignInSettings: (
  value: unknown,
) => LocalSignInSettings | null = (
  value: unknown,
): LocalSignInSettings | null => {
  const settings: JSONObject | null = readObject(value);

  if (!settings) {
    return null;
  }

  const authenticatorAppCount: number | null = readCount(
    settings["authenticatorAppCount"],
  );
  const passkeyAndSecurityKeyCount: number | null = readCount(
    settings["passkeyAndSecurityKeyCount"],
  );
  const backupCodeCount: number | null = readCount(settings["backupCodeCount"]);

  if (
    typeof settings["hasPassword"] !== "boolean" ||
    typeof settings["isTwoFactorAuthEnabled"] !== "boolean" ||
    authenticatorAppCount === null ||
    passkeyAndSecurityKeyCount === null ||
    backupCodeCount === null
  ) {
    return null;
  }

  return {
    hasPassword: settings["hasPassword"],
    isTwoFactorAuthEnabled: settings["isTwoFactorAuthEnabled"],
    authenticatorAppCount: authenticatorAppCount,
    passkeyAndSecurityKeyCount: passkeyAndSecurityKeyCount,
    backupCodeCount: backupCodeCount,
  };
};

// The clear's answer, or null for anything it would not answer.
export const readClearLocalSignInAnswer: (
  value: unknown,
) => ClearLocalSignInAnswer | null = (
  value: unknown,
): ClearLocalSignInAnswer | null => {
  const answer: JSONObject | null = readObject(value);

  if (!answer) {
    return null;
  }

  const cleared: LocalSignInSettings | null = readLocalSignInSettings(
    answer["cleared"],
  );
  const sessionsEnded: number | null = readCount(answer["sessionsEnded"]);

  if (!cleared || sessionsEnded === null) {
    return null;
  }

  return { cleared: cleared, sessionsEnded: sessionsEnded };
};

// The Require SSO card's count, or null for anything it would not answer.
export const readSavedSignInSettingsAnswer: (
  value: unknown,
) => SavedSignInSettingsAnswer | null = (
  value: unknown,
): SavedSignInSettingsAnswer | null => {
  const peopleCount: number | null = readCount(
    readObject(value)?.["peopleCount"],
  );

  return peopleCount === null ? null : { peopleCount: peopleCount };
};

// The Require SSO card's clear, or null for anything it would not answer.
export const readClearSavedSignInSettingsAnswer: (
  value: unknown,
) => ClearSavedSignInSettingsAnswer | null = (
  value: unknown,
): ClearSavedSignInSettingsAnswer | null => {
  const peopleCleared: number | null = readCount(
    readObject(value)?.["peopleCleared"],
  );

  return peopleCleared === null ? null : { peopleCleared: peopleCleared };
};
