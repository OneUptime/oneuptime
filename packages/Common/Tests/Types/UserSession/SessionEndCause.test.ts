import { describe, expect, test } from "@jest/globals";
import {
  getSessionEndCauseRevokedReason,
  isSessionTimeoutCause,
  NamedSessionEndCause,
  readSessionEndCause,
  SESSION_END_CAUSE_REVOKED_REASONS,
  SessionEndCause,
} from "../../../Types/UserSession/SessionEndCause";
import { SESSION_END_REVOKED_REASONS } from "../../../Server/Services/UserSessionService";
import { SessionEndReason } from "../../../Types/UserSession/SessionLength";

/*
 * Why a session ended (issue #6762). Each cause is kept with the words
 * sessions have always been revoked with, in UserSession.revokedReason - a
 * refresh after the end reads them to say why, and the audit log reads them
 * to say how the session ended. The words are a contract with every session
 * row already revoked, so they never change.
 */

const NAMED_CAUSES: Array<NamedSessionEndCause> = Object.values(
  SessionEndCause,
).filter((cause: SessionEndCause): boolean => {
  return cause !== SessionEndCause.Other;
}) as Array<NamedSessionEndCause>;

describe("the words each cause is revoked with", () => {
  test("are the words sessions have always been revoked with", () => {
    expect(SESSION_END_CAUSE_REVOKED_REASONS).toEqual({
      [SessionEndCause.SignedOut]: "User logout",
      [SessionEndCause.IdleTimeout]: "Idle timeout reached",
      [SessionEndCause.LengthReached]: "Session length reached",
      [SessionEndCause.Expired]: "Refresh token expired",
      [SessionEndCause.PasswordChanged]: "Password changed",
      [SessionEndCause.PasswordReset]: "Password reset",
      [SessionEndCause.AccountBlocked]: "User blocked",
      [SessionEndCause.TwoFactorRequired]: "Two factor auth required by admin",
      [SessionEndCause.TwoFactorReset]: "Two factor auth reset by admin",
    });
  });

  // UserSession.revokedReason is a ShortText column: 100 characters.
  test("fit the column, so the write that ends a session never fails on them", () => {
    for (const cause of NAMED_CAUSES) {
      expect(getSessionEndCauseRevokedReason(cause).length).toBeLessThanOrEqual(
        100,
      );
    }
  });

  test("are each a cause's own", () => {
    const reasons: Array<string> = NAMED_CAUSES.map(
      (cause: NamedSessionEndCause): string => {
        return getSessionEndCauseRevokedReason(cause);
      },
    );

    expect(new Set(reasons).size).toBe(reasons.length);
  });

  /*
   * The session lengths' own reasons are a cause's words too: a refresh
   * after a sweep ended a session reads them back (getSessionLengthEndReason)
   * and the audit log reads the same words as a timeout.
   */
  test("the session lengths' reasons are the timeouts' words", () => {
    expect(SESSION_END_REVOKED_REASONS[SessionEndReason.LengthReached]).toBe(
      getSessionEndCauseRevokedReason(SessionEndCause.LengthReached),
    );
    expect(SESSION_END_REVOKED_REASONS[SessionEndReason.Inactive]).toBe(
      getSessionEndCauseRevokedReason(SessionEndCause.IdleTimeout),
    );
  });
});

describe("reading the cause a revocation was kept with", () => {
  test("reads every cause back from its words", () => {
    for (const cause of NAMED_CAUSES) {
      expect(readSessionEndCause(getSessionEndCauseRevokedReason(cause))).toBe(
        cause,
      );
    }
  });

  test("anything else is Other", () => {
    for (const reason of [
      null,
      undefined,
      "",
      "Session missing user",
      "User not found",
      "user logout",
      42,
      { reason: "User logout" },
    ]) {
      expect(readSessionEndCause(reason)).toBe(SessionEndCause.Other);
    }
  });
});

describe("which causes are timeouts", () => {
  test("the idle timeout, the session length and 30 days without use", () => {
    expect(
      Object.values(SessionEndCause).filter(
        (cause: SessionEndCause): boolean => {
          return isSessionTimeoutCause(cause);
        },
      ),
    ).toEqual([
      SessionEndCause.IdleTimeout,
      SessionEndCause.LengthReached,
      SessionEndCause.Expired,
    ]);
  });
});
