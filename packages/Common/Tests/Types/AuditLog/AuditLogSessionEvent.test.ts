import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_ACTION_LABELS,
  getAuditLogActionLabel,
} from "../../../Types/AuditLog/AuditLogActionLabel";
import {
  AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS,
  AUDIT_LOG_SESSION_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELDS,
  AUDIT_LOG_SESSION_REASON_WORDS,
  AUDIT_LOG_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE,
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  AUDIT_LOG_SESSION_TIME_FIELDS,
  AuditLogSessionField,
  getSessionEndAuditLogAction,
  getSessionEntrySummary,
  getSessionEntryValueInLanguage,
  getSessionFieldLabel,
  isSessionAuditLogAction,
  readSessionEntryFields,
  SESSION_AUDIT_LOG_ACTIONS,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import {
  SIGN_IN_FAILURE_REASON_DESCRIPTIONS,
  SignInFailureReason,
} from "../../../Types/AuditLog/AuditLogSignInFailure";
import {
  createTranslator,
  Translator,
  TextLookup,
} from "../../../Types/Translator";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import User from "../../../Models/DatabaseModels/User";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";
import { DEFAULT_SESSION_IDLE_DAYS } from "../../../Types/UserSession/SessionLength";
import { JSONValue } from "../../../Types/JSON";

/*
 * People's sessions in the audit log (issue #6762): the actions, what each
 * session end is recorded as, the fields an entry carries, and the words
 * the audit log's table reads them by.
 */

describe("the session actions", () => {
  // A failed sign-in (issue #6788) is drawn with the sign-ins it failed to be.
  test("are sign in, a failed sign-in, sign out, a timeout and a revocation", () => {
    expect(SESSION_AUDIT_LOG_ACTIONS).toEqual([
      AuditLogAction.SignIn,
      AuditLogAction.SignInFailed,
      AuditLogAction.SignOut,
      AuditLogAction.SessionTimeout,
      AuditLogAction.SessionRevoked,
    ]);
  });

  test("are told apart from the changes", () => {
    for (const action of SESSION_AUDIT_LOG_ACTIONS) {
      expect(isSessionAuditLogAction(action)).toBe(true);
    }

    for (const action of [
      AuditLogAction.Create,
      AuditLogAction.Update,
      AuditLogAction.Delete,
      AuditLogAction.Download,
      "Sign In",
      "signin",
      undefined,
      null,
      7,
    ]) {
      expect(isSessionAuditLogAction(action)).toBe(false);
    }
  });

  test("an entry, the API and an export carry each as one word", () => {
    expect([
      AuditLogAction.SignIn,
      AuditLogAction.SignInFailed,
      AuditLogAction.SignOut,
      AuditLogAction.SessionTimeout,
      AuditLogAction.SessionRevoked,
    ]).toEqual([
      "SignIn",
      "SignInFailed",
      "SignOut",
      "SessionTimeout",
      "SessionRevoked",
    ]);
  });
});

describe("what a session's end is recorded as", () => {
  test("signing out is a Sign Out", () => {
    expect(getSessionEndAuditLogAction(SessionEndCause.SignedOut)).toBe(
      AuditLogAction.SignOut,
    );
  });

  test("an idle timeout, a session length and 30 days without use are a Session Timeout", () => {
    for (const cause of [
      SessionEndCause.IdleTimeout,
      SessionEndCause.LengthReached,
      SessionEndCause.Expired,
    ]) {
      expect(getSessionEndAuditLogAction(cause)).toBe(
        AuditLogAction.SessionTimeout,
      );
    }
  });

  test("everything else OneUptime ended is a Session Revoked", () => {
    for (const cause of [
      SessionEndCause.PasswordChanged,
      SessionEndCause.PasswordReset,
      SessionEndCause.AccountBlocked,
      SessionEndCause.TwoFactorRequired,
      SessionEndCause.TwoFactorReset,
      SessionEndCause.SignedInWithoutSso,
      // A master admin cleared their sign-in settings (#9762).
      SessionEndCause.SignInSettingsCleared,
      SessionEndCause.Other,
    ]) {
      expect(getSessionEndAuditLogAction(cause)).toBe(
        AuditLogAction.SessionRevoked,
      );
    }
  });

  test("every cause is described, and 30 days without use says its days", () => {
    for (const cause of Object.values(SessionEndCause)) {
      expect(SESSION_END_CAUSE_DESCRIPTIONS[cause].length).toBeGreaterThan(0);
    }

    expect(SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired]).toBe(
      `Not used for ${DEFAULT_SESSION_IDLE_DAYS} days`,
    );
    expect(SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignedOut]).toBe(
      "Signed out",
    );
    // Says who ended it and why, in the reader's words (#9762).
    expect(
      SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignInSettingsCleared],
    ).toBe("Signed out by a server admin who cleared their sign-in settings");
  });
});

describe("what a session entry is about", () => {
  // The resource type is the session model's own name, as every entry's is.
  test("the session, by UserSession's name, rolling up to its User", () => {
    expect(AUDIT_LOG_SESSION_RESOURCE_TYPE).toBe(
      new UserSession().singularName,
    );
    expect(AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE).toBe(new User().singularName);
  });
});

describe("the fields of a session entry", () => {
  test("each has its words, and the times are named", () => {
    expect(AUDIT_LOG_SESSION_FIELDS).toEqual(
      Object.values(AuditLogSessionField),
    );

    for (const field of AUDIT_LOG_SESSION_FIELDS) {
      expect(AUDIT_LOG_SESSION_FIELD_LABELS[field].length).toBeGreaterThan(0);
    }

    expect(AUDIT_LOG_SESSION_FIELD_LABELS[AuditLogSessionField.IpAddress]).toBe(
      "IP address",
    );
    expect(AUDIT_LOG_SESSION_TIME_FIELDS).toEqual([
      AuditLogSessionField.FirstFailedAt,
      AuditLogSessionField.SignedInAt,
      AuditLogSessionField.LastActiveAt,
      AuditLogSessionField.EndedAt,
    ]);
  });

  // Issue #6788: the two a failed sign-in adds, where the dialog lists them.
  test("a failed sign-in's count follows its reason, and its first attempt the place", () => {
    expect(
      AUDIT_LOG_SESSION_FIELDS.indexOf(AuditLogSessionField.FailedAttempts),
    ).toBe(AUDIT_LOG_SESSION_FIELDS.indexOf(AuditLogSessionField.Reason) + 1);
    expect(
      AUDIT_LOG_SESSION_FIELDS.indexOf(AuditLogSessionField.FirstFailedAt),
    ).toBe(AUDIT_LOG_SESSION_FIELDS.indexOf(AuditLogSessionField.Location) + 1);
    expect(
      AUDIT_LOG_SESSION_FIELD_LABELS[AuditLogSessionField.FailedAttempts],
    ).toBe("Failed attempts");
    expect(
      AUDIT_LOG_SESSION_FIELD_LABELS[AuditLogSessionField.FirstFailedAt],
    ).toBe("First attempt at");
  });

  test("are read from an entry's changes, the text ones only", () => {
    /*
     * Anything a JSON column holds, not only changes: the reading steps
     * over what is not one.
     */
    const changes: Array<JSONValue> = [
      { field: "signInMethod", newValue: "Password" },
      { field: "ipAddress", newValue: "203.0.113.7" },
      // Not a session field: left out.
      { field: "name", newValue: "Monitor" },
      // Not text: left out.
      { field: "device", newValue: 42 },
      // Blank: left out.
      { field: "location", newValue: "   " },
      // Not a change at all.
      "signInMethod",
      null,
      ["field"],
    ];

    expect(Array.from(readSessionEntryFields(changes).entries())).toEqual([
      [AuditLogSessionField.SignInMethod, "Password"],
      [AuditLogSessionField.IpAddress, "203.0.113.7"],
    ]);
  });

  test("an entry without changes has no fields", () => {
    expect(readSessionEntryFields(undefined).size).toBe(0);
    expect(readSessionEntryFields({}).size).toBe(0);
    expect(readSessionEntryFields("changes").size).toBe(0);
  });
});

describe("a session entry in a few words", () => {
  test("a sign-in says how: its method and second factor", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignIn,
        changes: [
          { field: "signInMethod", newValue: "Password" },
          { field: "secondFactor", newValue: "Authenticator app" },
        ],
      }),
    ).toBe("Password + Authenticator app");
  });

  test("a single sign-on says its provider when the entry names it", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignIn,
        changes: [
          { field: "signInMethod", newValue: "SAML single sign-on" },
          { field: "ssoProvider", newValue: "Acme Okta" },
        ],
      }),
    ).toBe("SAML single sign-on · Acme Okta");
  });

  test("a sign-in that does not say how is just a sign-in", () => {
    expect(
      getSessionEntrySummary({ action: AuditLogAction.SignIn, changes: [] }),
    ).toBe("Signed in");
  });

  test("an end says why", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SessionTimeout,
        changes: [
          { field: "reason", newValue: "Idle timeout reached" },
          { field: "signInMethod", newValue: "Password" },
        ],
      }),
    ).toBe("Idle timeout reached");
  });

  test("an end that does not say why says it ended", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SessionRevoked,
        changes: undefined,
      }),
    ).toBe("Session ended");
  });
});

describe("the words of every action", () => {
  test("each action has its words, the changes as they always read", () => {
    expect(AUDIT_LOG_ACTION_LABELS).toEqual({
      Create: "Create",
      Update: "Update",
      Delete: "Delete",
      Download: "Download",
      SignIn: "Sign In",
      SignInFailed: "Sign-In Failed",
      SignOut: "Sign Out",
      SessionTimeout: "Session Timeout",
      SessionRevoked: "Session Revoked",
    });
  });

  test("an action this release does not know reads as it is", () => {
    expect(getAuditLogActionLabel("SignIn")).toBe("Sign In");
    expect(getAuditLogActionLabel("Archive")).toBe("Archive");
    expect(getAuditLogActionLabel(undefined)).toBe("Unknown");
    expect(getAuditLogActionLabel("")).toBe("Unknown");
  });
});

/*
 * A failed sign-in (issue #6788) as the table and the dialog read it: why
 * it failed, and how many attempts the entry stands for when it is more
 * than its own; nobody signed in, so the way they tried is not "Signed in
 * with".
 */
describe("a failed sign-in in a few words", () => {
  test("says why it failed", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [
          { field: "reason", newValue: "Wrong password" },
          { field: "signInMethod", newValue: "Password" },
          { field: "ipAddress", newValue: "203.0.113.7" },
        ],
      }),
    ).toBe("Wrong password");
  });

  test("and how many attempts it stands for, when it is more than one", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [
          { field: "reason", newValue: "Wrong authenticator code" },
          { field: "failedAttempts", newValue: "37" },
        ],
      }),
    ).toBe("Wrong authenticator code · 37 attempts");
  });

  test("a count of one, or one that is no count, is left out", () => {
    for (const count of ["1", "0", "-4", "two", "1.5", ""]) {
      expect(
        getSessionEntrySummary({
          action: AuditLogAction.SignInFailed,
          changes: [
            { field: "reason", newValue: "Wrong password" },
            { field: "failedAttempts", newValue: count },
          ],
        }),
      ).toBe("Wrong password");
    }
  });

  test("one that stored no reason says the sign-in failed", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [],
      }),
    ).toBe("Sign-in failed");
  });

  test("never reads as a sign-in, whatever way it tried", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [
          { field: "reason", newValue: "Single sign-on refused" },
          { field: "signInMethod", newValue: "SAML single sign-on" },
          { field: "ssoProvider", newValue: "Acme Okta" },
        ],
      }),
    ).toBe("Single sign-on refused");
  });
});

describe("what the dialog calls a failed sign-in's fields", () => {
  test("the way it tried is not the way it signed in", () => {
    expect(
      getSessionFieldLabel({
        field: AuditLogSessionField.SignInMethod,
        action: AuditLogAction.SignInFailed,
      }),
    ).toBe("Tried to sign in with");
    expect(
      getSessionFieldLabel({
        field: AuditLogSessionField.SignInMethod,
        action: AuditLogAction.SignIn,
      }),
    ).toBe("Signed in with");
  });

  test("every other field reads as it does for a session", () => {
    for (const field of AUDIT_LOG_SESSION_FIELDS) {
      if (field === AuditLogSessionField.SignInMethod) {
        continue;
      }

      expect(
        getSessionFieldLabel({ field, action: AuditLogAction.SignInFailed }),
      ).toBe(AUDIT_LOG_SESSION_FIELD_LABELS[field]);
    }

    expect(
      getSessionFieldLabel({
        field: AuditLogSessionField.Reason,
        action: undefined,
      }),
    ).toBe("Reason");
  });
});

describe("the reasons an entry stores in OneUptime's own words", () => {
  test("are every session end's, a status page's sign-in no longer accepted, and every failed sign-in's", () => {
    for (const words of Object.values(SESSION_END_CAUSE_DESCRIPTIONS)) {
      expect(AUDIT_LOG_SESSION_REASON_WORDS).toContain(words);
    }

    for (const reason of Object.values(SignInFailureReason)) {
      expect(AUDIT_LOG_SESSION_REASON_WORDS).toContain(
        SIGN_IN_FAILURE_REASON_DESCRIPTIONS[reason],
      );
    }

    expect(AUDIT_LOG_SESSION_REASON_WORDS).toContain(
      AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
    );
  });
});

describe("a failed sign-in's values in the reader's language", () => {
  const GERMAN: Record<string, string> = {
    "Wrong password": "Falsches Passwort",
    "Sign-in no longer accepted by the status page":
      "Anmeldung von der Statusseite nicht mehr akzeptiert",
    "{{count}} attempts": "{{count}} Versuche",
    "{{count}} attempts_one": "{{count}} Versuch",
    "Sign-in failed": "Anmeldung fehlgeschlagen",
  };

  const lookup: TextLookup = (key: string): string | undefined => {
    return GERMAN[key];
  };

  const german: Translator = createTranslator(lookup, "de");

  test("why it failed, and a reader's status page session's end, are OneUptime's words", () => {
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.Reason,
        value: "Wrong password",
        translator: german,
      }),
    ).toBe("Falsches Passwort");
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.Reason,
        value: AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
        translator: german,
      }),
    ).toBe("Anmeldung von der Statusseite nicht mehr akzeptiert");
  });

  test("a reason no release wrote is drawn as stored", () => {
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.Reason,
        value: "Wrong password!",
        translator: german,
      }),
    ).toBe("Wrong password!");
  });

  test("a count is written in the reader's digits", () => {
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.FailedAttempts,
        value: "1234",
        translator: german,
      }),
    ).toBe("1.234");
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.FailedAttempts,
        value: "1234",
        translator: createTranslator(undefined, "fa"),
      }),
    ).toBe("۱٬۲۳۴");
    // One that is no count is drawn as stored.
    expect(
      getSessionEntryValueInLanguage({
        field: AuditLogSessionField.FailedAttempts,
        value: "many",
        translator: german,
      }),
    ).toBe("many");
  });

  test("the summary counts in the reader's plural forms", () => {
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [
          { field: "reason", newValue: "Wrong password" },
          { field: "failedAttempts", newValue: "37" },
        ],
        translator: german,
      }),
    ).toBe("Falsches Passwort · 37 Versuche");
    expect(
      getSessionEntrySummary({
        action: AuditLogAction.SignInFailed,
        changes: [],
        translator: german,
      }),
    ).toBe("Anmeldung fehlgeschlagen");
  });

  test("the plural is the one the locales already hold", () => {
    expect(AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS).toEqual({
      one: "{{count}} attempt",
      other: "{{count}} attempts",
    });
  });
});
