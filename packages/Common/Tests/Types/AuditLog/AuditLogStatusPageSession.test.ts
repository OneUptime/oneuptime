import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import {
  AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE,
  AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE,
  readStatusPageSessionEnd,
  STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON,
  STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON,
  STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
  STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
} from "../../../Types/AuditLog/AuditLogStatusPageSession";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import UserType from "../../../Types/UserType";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";

/*
 * A private status page's readers' sessions in the audit log (issue #6790):
 * what an entry is about, who its actor is, and how each end is read from
 * the words the session was revoked with.
 */

describe("what a reader's session entry is about", () => {
  // The resource types are the models' own names, as every entry's are.
  test("the session, by its model's name, rolling up to the status page", () => {
    expect(AUDIT_LOG_STATUS_PAGE_SESSION_RESOURCE_TYPE).toBe(
      new StatusPagePrivateUserSession().singularName,
    );
    expect(AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE).toBe(
      new StatusPage().singularName,
    );
  });

  test("its actor is a reader, no OneUptime user of any kind", () => {
    expect(AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE).toBe(
      "StatusPagePrivateUser",
    );
    expect(Object.values(UserType) as Array<string>).not.toContain(
      AUDIT_LOG_STATUS_PAGE_READER_ACTOR_TYPE,
    );
  });
});

describe("how a reader's session ended, from the words it was revoked with", () => {
  test("signing out is a Sign Out", () => {
    expect(
      readStatusPageSessionEnd(STATUS_PAGE_SESSION_SIGNED_OUT_REASON),
    ).toEqual({
      action: AuditLogAction.SignOut,
      reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignedOut],
    });
  });

  test("a refresh token that ran out is a Session Timeout, thirty days without use", () => {
    expect(
      readStatusPageSessionEnd(
        STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON,
      ),
    ).toEqual({
      action: AuditLogAction.SessionTimeout,
      reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Expired],
    });
  });

  test("a new password is a Session Revoked, because the password changed", () => {
    expect(
      readStatusPageSessionEnd(STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON),
    ).toEqual({
      action: AuditLogAction.SessionRevoked,
      reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.PasswordChanged],
    });
  });

  test("a sign-in the page no longer accepts is a Session Revoked that says so", () => {
    expect(
      readStatusPageSessionEnd(
        STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
      ),
    ).toEqual({
      action: AuditLogAction.SessionRevoked,
      reason: AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
    });
  });

  test("anything else OneUptime ended is a Session Revoked: a session that ended", () => {
    for (const reason of [
      "Status page mismatch",
      "Session missing user",
      "User not found",
      "Login code user no longer matches the session",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(readStatusPageSessionEnd(reason)).toEqual({
        action: AuditLogAction.SessionRevoked,
        reason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other],
      });
    }
  });

  // The words the status page's routes and services revoke with, kept as they were.
  test("the words a reader's session is revoked with are the ones it always was", () => {
    expect(STATUS_PAGE_SESSION_SIGNED_OUT_REASON).toBe("User logged out");
    expect(STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON).toBe(
      "Password changed",
    );
    expect(STATUS_PAGE_SESSION_REFRESH_TOKEN_EXPIRED_REASON).toBe(
      "Refresh token expired",
    );
    expect(STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON).toBe(
      "Its sign-in is no longer accepted by the status page",
    );
  });
});
