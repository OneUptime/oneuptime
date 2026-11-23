import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

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

/*
 * ONE PERSON AT A TIME, FROM THE PROJECT'S USERS PAGE (#9993). The count
 * above says how many; the owner could clear all of them or none - not the
 * one who just left the organization, nor see who they were. So the
 * project's Users list (Settings > Users, "the Members page") asks, for the
 * people its page shows, which of them still have settings saved that this
 * owner may clear, and offers Clear Sign-In Settings on their rows:
 *
 *   POST /project/:projectId/saved-sign-in-settings/people
 *        { userIds: [...] }                - which of these, and what each has
 *   POST /project/:projectId/saved-sign-in-settings/people/:userId/clear
 *                                          - clear that one person's
 *
 * Under the rule of the count, exactly, on every request of both
 * (Server/Utils/ProjectSignInClearing): only a member of this project whose
 * every project, an invitation not accepted yet included, manages sign-in
 * with SSO and is one the clearing person owns; never a master admin, never
 * the owner. The list names a person across the owner's projects, which a
 * count never does, so it names nobody the owner does not already see on
 * the project's Users list: only people the page asked about - the rows it
 * drew - who are members of this project, and by their ids alone. Their
 * names are the page's own.
 */
export const PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION: string =
  "saved-sign-in-settings/people";

// The clear of one person, with their id in place of :userId.
export const PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION: string =
  "saved-sign-in-settings/people/:userId/clear";

export const getProjectSavedSignInSettingsOfPeopleRoute: (
  projectId: string,
) => string = (projectId: string): string => {
  return `/project/${projectId}/${PROJECT_SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_ACTION}`;
};

export const getProjectClearPersonSavedSignInSettingsRoute: (
  projectId: string,
  userId: string,
) => string = (projectId: string, userId: string): string => {
  return `/project/${projectId}/${PROJECT_CLEAR_PERSON_SAVED_SIGN_IN_SETTINGS_ACTION.replace(
    ":userId",
    userId,
  )}`;
};

// The most people one ask may name: a list's largest page.
export const MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK: number = 100;

export const SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE: string =
  "Name the people to ask about by user ID.";

export const SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_TOO_MANY_MESSAGE: string = `Ask about at most ${MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK} people at a time.`;

/*
 * Why one person's clear was refused: the rule, never which part of it.
 * Whether somebody has a project elsewhere, is a master admin or has
 * nothing saved is not this owner's to learn.
 */
export const CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE: string =
  "You can't clear this person's sign-in settings from this project. You can clear them only for a member whose every project is one you own that manages sign-in with SSO, and who still has some saved.";

// One person of the list: who, by id, and what they have saved.
export interface PersonSavedSignInSettings {
  // Lower-cased, as the page reads a row's user.
  userId: string;
  settings: LocalSignInSettings;
}

/*
 * The people asked about, as the server takes them: their user ids, each
 * once, at most MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK. Anything else is
 * refused rather than guessed at - throws the message to answer with.
 */
export const readSavedSignInSettingsOfPeopleRequest: (
  body: unknown,
) => Array<ObjectID> = (body: unknown): Array<ObjectID> => {
  const userIds: unknown = readObject(body)?.["userIds"];

  if (
    !Array.isArray(userIds) ||
    userIds.some((userId: unknown): boolean => {
      return typeof userId !== "string" || !ObjectID.isValidUUID(userId);
    })
  ) {
    throw new BadDataException(
      SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_BAD_REQUEST_MESSAGE,
    );
  }

  const unique: Array<string> = Array.from(
    new Set<string>(
      (userIds as Array<string>).map((userId: string): string => {
        return userId.trim().toLowerCase();
      }),
    ),
  );

  if (unique.length > MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK) {
    throw new BadDataException(
      SAVED_SIGN_IN_SETTINGS_OF_PEOPLE_TOO_MANY_MESSAGE,
    );
  }

  return unique.map((userId: string): ObjectID => {
    return new ObjectID(userId);
  });
};

// The ask, as the Dashboard sends it: each id once, lower-cased.
export const toSavedSignInSettingsOfPeopleRequestJSON: (
  userIds: ReadonlyArray<string>,
) => JSONObject = (userIds: ReadonlyArray<string>): JSONObject => {
  return {
    userIds: Array.from(
      new Set<string>(
        userIds
          .map((userId: string): string => {
            return userId.trim().toLowerCase();
          })
          .filter((userId: string): boolean => {
            return Boolean(userId);
          }),
      ),
    ),
  };
};

// The answer, as the route sends it.
export const toSavedSignInSettingsOfPeopleAnswerJSON: (
  people: ReadonlyArray<PersonSavedSignInSettings>,
) => JSONObject = (
  people: ReadonlyArray<PersonSavedSignInSettings>,
): JSONObject => {
  return {
    people: people.map((person: PersonSavedSignInSettings): JSONObject => {
      return {
        userId: person.userId.toLowerCase(),
        settings: { ...person.settings },
      };
    }),
  };
};

/*
 * The answer, as the Dashboard reads it: each person once, by a user id
 * and settings that say something saved; anybody else is dropped, so a
 * row never offers to clear nothing. Null for an answer that is no list.
 */
export const readSavedSignInSettingsOfPeopleAnswer: (
  value: unknown,
) => Array<PersonSavedSignInSettings> | null = (
  value: unknown,
): Array<PersonSavedSignInSettings> | null => {
  const people: unknown = readObject(value)?.["people"];

  if (!Array.isArray(people)) {
    return null;
  }

  const seen: Set<string> = new Set<string>();
  const answer: Array<PersonSavedSignInSettings> = [];

  for (const entry of people) {
    const person: JSONObject | null = readObject(entry);
    const userId: string =
      typeof person?.["userId"] === "string"
        ? (person["userId"] as string).trim().toLowerCase()
        : "";
    const settings: LocalSignInSettings | null = readLocalSignInSettings(
      person?.["settings"],
    );

    if (
      !userId ||
      !ObjectID.isValidUUID(userId) ||
      seen.has(userId) ||
      !settings ||
      !hasLocalSignInSettings(settings)
    ) {
      continue;
    }

    seen.add(userId);
    answer.push({ userId: userId, settings: settings });
  }

  return answer;
};

/*
 * What one person has saved in OneUptime to sign in with: everything the
 * count of people with settings saved counts (the Admin Dashboard's and a
 * project's Require SSO card), so that what a clear says it removed - in the
 * audit log and the person's email - is never less than what it counted
 * them for (#9992).
 */
export interface LocalSignInSettings {
  hasPassword: boolean;
  /*
   * A password reset link that still works: one asked for with Forgot
   * password?, or sent by a master admin, and not used or expired yet. It
   * sets a password, so it is a way in - and somebody with no password can
   * have one, to set their first.
   */
  hasPasswordResetLink: boolean;
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
  hasPasswordResetLink: false,
  isTwoFactorAuthEnabled: false,
  authenticatorAppCount: 0,
  passkeyAndSecurityKeyCount: 0,
  backupCodeCount: 0,
};

/*
 * Whether a person has anything saved to clear - each thing the count of
 * people with settings saved counts them for, a working reset link among
 * them (#9992).
 */
export const hasLocalSignInSettings: (
  settings: LocalSignInSettings,
) => boolean = (settings: LocalSignInSettings): boolean => {
  return (
    settings.hasPassword ||
    settings.hasPasswordResetLink ||
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

  /*
   * A reset link is read when it is there, and none when it is left out:
   * the answer of a server from before #9992, during an upgrade, names
   * none. Anything but true or false is no answer.
   */
  const hasPasswordResetLink: unknown =
    settings["hasPasswordResetLink"] === undefined
      ? false
      : settings["hasPasswordResetLink"];

  if (
    typeof settings["hasPassword"] !== "boolean" ||
    typeof hasPasswordResetLink !== "boolean" ||
    typeof settings["isTwoFactorAuthEnabled"] !== "boolean" ||
    authenticatorAppCount === null ||
    passkeyAndSecurityKeyCount === null ||
    backupCodeCount === null
  ) {
    return null;
  }

  return {
    hasPassword: settings["hasPassword"],
    hasPasswordResetLink: hasPasswordResetLink,
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
