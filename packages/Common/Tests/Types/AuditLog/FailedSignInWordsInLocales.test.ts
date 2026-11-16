import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_ACTION_LABELS } from "../../../Types/AuditLog/AuditLogActionLabel";
import {
  AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS,
  AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELD_LABELS,
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  AUDIT_LOG_SIGN_IN_FAILED,
  AuditLogSessionField,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import {
  AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
  SIGN_IN_FAILURE_REASON_DESCRIPTIONS,
  SignInFailureReason,
} from "../../../Types/AuditLog/AuditLogSignInFailure";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * EVERY WORD OF A FAILED SIGN-IN AND OF A READER'S SESSION, IN EVERY
 * LANGUAGE (issues #6788, #6790).
 *
 * The audit log draws a failed sign-in's action, the attempt it is about,
 * why it failed, its two fields of its own and the way it tried, and a
 * status page reader's session that the page no longer accepts, in the
 * reader's language: each is a key of the Dashboard's locales, worded in
 * every one, its placeholders kept.
 */

const WORDS: ReadonlyArray<string> = [
  AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignInFailed],
  AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
  ...Object.values(SignInFailureReason).map(
    (reason: SignInFailureReason): string => {
      return SIGN_IN_FAILURE_REASON_DESCRIPTIONS[reason];
    },
  ),
  AUDIT_LOG_SESSION_FIELD_LABELS[AuditLogSessionField.FailedAttempts],
  AUDIT_LOG_SESSION_FIELD_LABELS[AuditLogSessionField.FirstFailedAt],
  AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS[AuditLogSessionField.SignInMethod]!,
  AUDIT_LOG_SIGN_IN_FAILED,
  AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.one,
  AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.other,
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
];

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("a failed sign-in's and a reader's session's words", () => {
  test("are keys of the English locale, each its own English", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of WORDS) {
      expect({ word, english: english[word] }).toEqual({
        word,
        english: word,
      });
    }

    // The plural's one form, read through its general key.
    expect(english[`${AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.other}_one`]).toBe(
      AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.one,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "are worded in %s, their placeholders kept",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const word of WORDS) {
        const translated: string | undefined = words[word];

        expect({
          word,
          worded: Boolean(translated && translated !== word),
        }).toEqual({
          word,
          worded: true,
        });
        expect(placeholdersOf(translated || "")).toEqual(placeholdersOf(word));
      }
    },
  );

  // A failed sign-in reads as the failure it is, not as the sign-in.
  test.each([...DASHBOARD_LANGUAGES])(
    "in %s, Sign-In Failed is not Sign In, nor the attempt the failure",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const failed: string | undefined =
        words[AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignInFailed]];

      expect(failed).not.toBe(
        words[AUDIT_LOG_ACTION_LABELS[AuditLogAction.SignIn]],
      );
      expect(failed).not.toBe(words[AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE]);
    },
  );
});
