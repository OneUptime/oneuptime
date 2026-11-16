import { describe, expect, test } from "@jest/globals";
import {
  AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
  isSignInFailureReason,
  SIGN_IN_FAILURE_REASON_DESCRIPTIONS,
  SignInFailureReason,
} from "../../../Types/AuditLog/AuditLogSignInFailure";
import { SESSION_END_CAUSE_DESCRIPTIONS } from "../../../Types/AuditLog/AuditLogSessionEvent";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";

/*
 * Why a sign-in failed (issue #6788), as an entry stores it and the audit
 * log reads it: one set of words a reason is stored in, never what the
 * person typed.
 */

describe("why a sign-in failed", () => {
  test("names each way it fails, a password, a second factor, the account and single sign-on", () => {
    expect(Object.values(SignInFailureReason)).toEqual([
      "WrongPassword",
      "WrongAuthenticatorCode",
      "WrongBackupCode",
      "SecurityKeyNotAccepted",
      "TooManyWrongCodes",
      "AccountBlocked",
      "EmailNotVerified",
      "SingleSignOnRequired",
      "SingleSignOnRefused",
    ]);
  });

  test("each has words of its own, and no two share them", () => {
    const words: Array<string> = Object.values(SignInFailureReason).map(
      (reason: SignInFailureReason): string => {
        return SIGN_IN_FAILURE_REASON_DESCRIPTIONS[reason];
      },
    );

    for (const text of words) {
      expect(text.trim().length).toBeGreaterThan(0);
    }

    expect(new Set(words).size).toBe(words.length);
    expect(SIGN_IN_FAILURE_REASON_DESCRIPTIONS).toEqual({
      WrongPassword: "Wrong password",
      WrongAuthenticatorCode: "Wrong authenticator code",
      WrongBackupCode: "Wrong backup code",
      SecurityKeyNotAccepted: "Security key not accepted",
      TooManyWrongCodes: "Too many wrong codes",
      AccountBlocked: "Account blocked by a server admin",
      EmailNotVerified: "Email not verified",
      SingleSignOnRequired: "Single sign-on required",
      SingleSignOnRefused: "Single sign-on refused",
    });
  });

  // A blocked account reads alike, whether it ended a session or refused a sign-in.
  test("a blocked account says what a session it ended says", () => {
    expect(
      SIGN_IN_FAILURE_REASON_DESCRIPTIONS[SignInFailureReason.AccountBlocked],
    ).toBe(SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.AccountBlocked]);
  });

  test("only a reason this release names is one", () => {
    for (const reason of Object.values(SignInFailureReason)) {
      expect(isSignInFailureReason(reason)).toBe(true);
    }

    for (const notOne of [
      "Wrong password",
      "wrongpassword",
      "",
      undefined,
      null,
      3,
      {},
    ]) {
      expect(isSignInFailureReason(notOne)).toBe(false);
    }
  });
});

describe("what a failed sign-in's entry is about", () => {
  test("the attempt, a Sign-In Attempt", () => {
    expect(AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE).toBe("Sign-In Attempt");
  });
});
