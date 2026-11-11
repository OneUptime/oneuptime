import {
  getSessionEntryChanges,
  getSessionEntryResourceName,
  isProviderNamedIn,
} from "../../../Server/AuditLog/AuditLogSessionEntries";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_FIELDS,
  AUDIT_LOG_SESSION_UNKNOWN_DEVICE,
  SessionAuditEvent,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import {
  SecondFactor,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import { describe, expect, test } from "@jest/globals";

/*
 * What one project's entry about a session says (issue #6762): the fields,
 * in their order, as text; a project's own SSO provider only in that
 * project; and the device the entry is named by.
 */

const USER_ID: ObjectID = new ObjectID("21212121-2121-4121-8121-212121212121");
const SESSION_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const PROJECT_A: ObjectID = new ObjectID(
  "24242424-2424-4424-8424-242424242424",
);
const PROJECT_B: ObjectID = new ObjectID(
  "25252525-2525-4525-8525-252525252525",
);

const SIGNED_IN_AT: Date = new Date("2026-11-11T08:00:00.000Z");
const LAST_ACTIVE_AT: Date = new Date("2026-11-11T09:15:00.000Z");
const ENDED_AT: Date = new Date("2026-11-11T09:45:00.000Z");

const signIn: (overrides?: Partial<SessionAuditEvent>) => SessionAuditEvent = (
  overrides?: Partial<SessionAuditEvent>,
): SessionAuditEvent => {
  return {
    action: AuditLogAction.SignIn,
    userId: USER_ID,
    sessionId: SESSION_ID,
    signIn: {
      method: SignInMethod.Password,
      secondFactor: SecondFactor.AuthenticatorApp,
    },
    device: "Chrome 130 on macOS",
    ipAddress: "203.0.113.7",
    location: "Berlin, Germany",
    ...(overrides || {}),
  };
};

const fields: (changes: JSONArray) => Array<string> = (
  changes: JSONArray,
): Array<string> => {
  return changes.map((change: unknown): string => {
    return String((change as JSONObject)["field"]);
  });
};

describe("a sign-in's entry", () => {
  test("says how and from where, in the audit log's order", () => {
    expect(
      getSessionEntryChanges({ event: signIn(), projectId: PROJECT_A }),
    ).toEqual([
      { field: "signInMethod", newValue: "Password" },
      { field: "secondFactor", newValue: "Authenticator app" },
      { field: "device", newValue: "Chrome 130 on macOS" },
      { field: "ipAddress", newValue: "203.0.113.7" },
      { field: "location", newValue: "Berlin, Germany" },
    ]);
  });

  test("never a reason, and none of the times: the entry's own time is the sign-in", () => {
    const changes: JSONArray = getSessionEntryChanges({
      event: signIn({
        endCause: SessionEndCause.SignedOut,
        signedInAt: SIGNED_IN_AT,
        lastActiveAt: LAST_ACTIVE_AT,
        endedAt: ENDED_AT,
      }),
      projectId: PROJECT_A,
    });

    expect(fields(changes)).not.toContain("reason");
    expect(fields(changes)).not.toContain("signedInAt");
    expect(fields(changes)).not.toContain("lastActiveAt");
    expect(fields(changes)).not.toContain("endedAt");
  });

  test("leaves out what it does not know", () => {
    expect(
      getSessionEntryChanges({
        event: {
          action: AuditLogAction.SignIn,
          userId: USER_ID,
          sessionId: SESSION_ID,
        },
        projectId: PROJECT_A,
      }),
    ).toEqual([]);
  });

  test("every field is one the audit log names", () => {
    for (const change of getSessionEntryChanges({
      event: signIn(),
      projectId: PROJECT_A,
    })) {
      expect(AUDIT_LOG_SESSION_FIELDS).toContain(
        (change as JSONObject)["field"],
      );
    }
  });
});

describe("a session end's entry", () => {
  test("says why it ended first, then how it signed in, and when it signed in, was used and ran out", () => {
    expect(
      getSessionEntryChanges({
        event: signIn({
          action: AuditLogAction.SessionTimeout,
          endCause: SessionEndCause.IdleTimeout,
          signedInAt: SIGNED_IN_AT,
          lastActiveAt: LAST_ACTIVE_AT,
          endedAt: ENDED_AT,
        }),
        projectId: PROJECT_A,
      }),
    ).toEqual([
      { field: "reason", newValue: "Idle timeout reached" },
      { field: "signInMethod", newValue: "Password" },
      { field: "secondFactor", newValue: "Authenticator app" },
      { field: "device", newValue: "Chrome 130 on macOS" },
      { field: "ipAddress", newValue: "203.0.113.7" },
      { field: "location", newValue: "Berlin, Germany" },
      { field: "signedInAt", newValue: "2026-11-11T08:00:00.000Z" },
      { field: "lastActiveAt", newValue: "2026-11-11T09:15:00.000Z" },
      { field: "endedAt", newValue: "2026-11-11T09:45:00.000Z" },
    ]);
  });

  test.each([
    [SessionEndCause.SignedOut, "Signed out"],
    [SessionEndCause.LengthReached, "Session length reached"],
    [SessionEndCause.Expired, "Not used for 30 days"],
    [SessionEndCause.PasswordChanged, "Password changed"],
    [SessionEndCause.PasswordReset, "Password reset"],
    [SessionEndCause.AccountBlocked, "Account blocked by a server admin"],
    [
      SessionEndCause.TwoFactorRequired,
      "Two-factor authentication required by a server admin",
    ],
    [
      SessionEndCause.TwoFactorReset,
      "Two-factor authentication reset by a server admin",
    ],
    [SessionEndCause.Other, "Session ended"],
  ])("%s reads as %p", (cause: SessionEndCause, reason: string) => {
    const changes: JSONArray = getSessionEntryChanges({
      event: signIn({ action: AuditLogAction.SessionRevoked, endCause: cause }),
      projectId: PROJECT_A,
    });

    expect(changes[0]).toEqual({ field: "reason", newValue: reason });
  });

  test("an end that does not say why has no reason", () => {
    expect(
      fields(
        getSessionEntryChanges({
          event: signIn({ action: AuditLogAction.SignOut }),
          projectId: PROJECT_A,
        }),
      ),
    ).not.toContain("reason");
  });

  test("a time that is not one is left out, never thrown on", () => {
    const changes: JSONArray = getSessionEntryChanges({
      event: signIn({
        action: AuditLogAction.SessionTimeout,
        endCause: SessionEndCause.Expired,
        signedInAt: new Date("not a time"),
        endedAt: ENDED_AT,
      }),
      projectId: PROJECT_A,
    });

    expect(fields(changes)).not.toContain("signedInAt");
    expect(fields(changes)).toContain("endedAt");
  });
});

describe("single sign-on in an entry", () => {
  const projectSso: SessionAuditEvent = signIn({
    signIn: {
      method: SignInMethod.Saml,
      ssoProviderName: "Acme Okta",
      ssoProjectId: PROJECT_A,
    },
  });

  test("a project's own provider is named in that project's entry", () => {
    expect(
      getSessionEntryChanges({ event: projectSso, projectId: PROJECT_A }),
    ).toEqual(
      expect.arrayContaining([
        { field: "signInMethod", newValue: "SAML single sign-on" },
        { field: "ssoProvider", newValue: "Acme Okta" },
      ]),
    );
  });

  /*
   * The person may be a member of other projects, whose admins learn that
   * they signed in with single sign-on - never which other project they
   * belong to, or what its provider is called.
   */
  test("and never in another project's", () => {
    const changes: JSONArray = getSessionEntryChanges({
      event: projectSso,
      projectId: PROJECT_B,
    });

    expect(fields(changes)).toContain("signInMethod");
    expect(fields(changes)).not.toContain("ssoProvider");
    expect(JSON.stringify(changes)).not.toContain("Acme Okta");
    expect(JSON.stringify(changes)).not.toContain(PROJECT_A.toString());
  });

  test("the server's own provider is named in every project", () => {
    const serverSso: SessionAuditEvent = signIn({
      signIn: {
        method: SignInMethod.OpenIdConnect,
        ssoProviderName: "Company Entra ID",
      },
    });

    for (const projectId of [PROJECT_A, PROJECT_B]) {
      expect(
        getSessionEntryChanges({ event: serverSso, projectId }),
      ).toContainEqual({ field: "ssoProvider", newValue: "Company Entra ID" });
    }
  });

  test("a provider is never named for a sign-in that is not single sign-on", () => {
    const changes: JSONArray = getSessionEntryChanges({
      event: signIn({
        signIn: {
          method: SignInMethod.Google,
          ssoProviderName: "Not a provider",
        },
      }),
      projectId: PROJECT_A,
    });

    expect(fields(changes)).not.toContain("ssoProvider");
  });

  test("a project is matched whatever the case of its id", () => {
    expect(
      isProviderNamedIn({
        ssoProjectId: new ObjectID(PROJECT_A.toString().toUpperCase()),
        projectId: PROJECT_A,
      }),
    ).toBe(true);
    expect(
      isProviderNamedIn({ ssoProjectId: PROJECT_A, projectId: PROJECT_B }),
    ).toBe(false);
    expect(
      isProviderNamedIn({ ssoProjectId: undefined, projectId: PROJECT_B }),
    ).toBe(true);
  });
});

describe("an entry's text", () => {
  test("is one short line, whatever reached it", () => {
    const changes: JSONArray = getSessionEntryChanges({
      event: signIn({
        device: `Chrome 130\non macOS${"!".repeat(500)}`,
        location: "\t\t",
      }),
      projectId: PROJECT_A,
    });

    const device: JSONObject = changes.find((change: unknown): boolean => {
      return (change as JSONObject)["field"] === "device";
    }) as JSONObject;

    expect(String(device["newValue"])).not.toContain("\n");
    expect(String(device["newValue"]).length).toBeLessThanOrEqual(100);
    expect(fields(changes)).not.toContain("location");
  });
});

describe("what an entry is named", () => {
  test("the device it signed in from", () => {
    expect(getSessionEntryResourceName(signIn())).toBe("Chrome 130 on macOS");
  });

  test("Unknown device, when that is not known", () => {
    expect(getSessionEntryResourceName(signIn({ device: undefined }))).toBe(
      AUDIT_LOG_SESSION_UNKNOWN_DEVICE,
    );
    expect(getSessionEntryResourceName(signIn({ device: "  " }))).toBe(
      "Unknown device",
    );
  });
});
