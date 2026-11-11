import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_ACTION_LABELS,
  getAuditLogActionLabel,
} from "../../../Types/AuditLog/AuditLogActionLabel";
import {
  AUDIT_LOG_SESSION_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELDS,
  AUDIT_LOG_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE,
  AUDIT_LOG_SESSION_TIME_FIELDS,
  AuditLogSessionField,
  getSessionEndAuditLogAction,
  getSessionEntrySummary,
  isSessionAuditLogAction,
  readSessionEntryFields,
  SESSION_AUDIT_LOG_ACTIONS,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import User from "../../../Models/DatabaseModels/User";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";
import { DEFAULT_SESSION_IDLE_DAYS } from "../../../Types/UserSession/SessionLength";
import { JSONArray } from "../../../Types/JSON";

/*
 * People's sessions in the audit log (issue #6762): the actions, what each
 * session end is recorded as, the fields an entry carries, and the words
 * the audit log's table reads them by.
 */

describe("the session actions", () => {
  test("are sign in, sign out, a timeout and a revocation", () => {
    expect(SESSION_AUDIT_LOG_ACTIONS).toEqual([
      AuditLogAction.SignIn,
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
      AuditLogAction.SignOut,
      AuditLogAction.SessionTimeout,
      AuditLogAction.SessionRevoked,
    ]).toEqual(["SignIn", "SignOut", "SessionTimeout", "SessionRevoked"]);
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
      AuditLogSessionField.SignedInAt,
      AuditLogSessionField.LastActiveAt,
      AuditLogSessionField.EndedAt,
    ]);
  });

  test("are read from an entry's changes, the text ones only", () => {
    const changes: JSONArray = [
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

    expect(
      Array.from(readSessionEntryFields(changes).entries()),
    ).toEqual([
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
