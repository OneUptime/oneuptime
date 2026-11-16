import ObjectID from "../ObjectID";
import { translationKey } from "../Translator";
import { SessionSignIn } from "../UserSession/SessionSignIn";

/*
 * FAILED SIGN-INS IN THE AUDIT LOG (issue #6788).
 *
 * PCI DSS 10.2.1.4 ("invalid logical access attempts") and most SOC 2
 * reviews ask the audit log for the sign-ins that failed, and they are what
 * an admin looks for after a suspected brute-force attempt. The audit log
 * records a Sign-In Failed entry for an attempt on an account that exists,
 * once the attempt has named the account - the address typed is the
 * account's, it is the second step of a sign-in that named it, or a single
 * sign-on provider vouched for it - and the attempt failed:
 *
 *   - a wrong password; a wrong authenticator code, backup code or security
 *     key; a code refused unchecked because too many wrong ones came before
 *     it (Server/Utils/TwoFactorWrongCodes);
 *   - a blocked account, an address not yet verified, or a password while
 *     the server requires single sign-on - which the sign-in only says to
 *     somebody who had the password right;
 *   - a single sign-on OneUptime refused for somebody the provider vouched
 *     for: a blocked account, or a sign-in the account must not make
 *     through that provider.
 *
 * An attempt on an address that is nobody's is not recorded: no project
 * could hold it. Nothing about the recording reaches the person signing in
 * either - the answer, and how long it takes, are what they always were -
 * so the audit log never tells them whether an account exists
 * (Server/Utils/AuditLog/FailedSignInAuditLog).
 *
 * WHERE: as a sign-in, in every project the account's person is a member of
 * that records audit logs, whether or not it stores system events. Read by
 * whoever reads that project's audit log.
 *
 * HOW MANY: anyone who knows an address can make failed attempts, from as
 * many networks as they like, so the entries are held to
 * FAILED_SIGN_INS_RECORDED_PER_WINDOW for an account in each
 * FAILED_SIGN_IN_WINDOW_IN_MINUTES, wherever the attempts come from. The
 * ones after that are counted, not dropped: the account's next entry says
 * how many attempts it stands for, its own included, and when the first of
 * them was made. A count is kept for FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS
 * after the last attempt.
 *
 * WHAT AN ENTRY SAYS:
 *
 *   - its resource is the attempt: a Sign-In Attempt, by an id of its own
 *     that every project's entry about it shares, named by the device it
 *     came from and rolling up to the account (User, by its id);
 *   - its actor is the account the attempt was made on, so filtering the
 *     audit log by a person's email finds their failed sign-ins too -
 *     whoever made the attempt never proved they are that person;
 *   - its fields: why it failed, how it tried to sign in (and with which
 *     provider), the device, the address and the place; and, for an entry
 *     that stands for more attempts than its own, how many and when the
 *     first one was (Types/AuditLog/AuditLogSessionEvent's fields).
 *
 * Never the password, a code, a token or an assertion, nor anything else
 * the person typed: the device is described in words OneUptime spells out
 * (UserAgentDevice), as for a sign-in.
 */

// The resource of every failed sign-in entry: the attempt.
export const AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE: string =
  translationKey("Sign-In Attempt");

// An account's attempts recorded one by one in each window.
export const FAILED_SIGN_INS_RECORDED_PER_WINDOW: number = 10;

// The window those are counted in, from the first of them.
export const FAILED_SIGN_IN_WINDOW_IN_MINUTES: number = 60;

/*
 * How long the attempts counted but not yet recorded are kept for the
 * account's next entry, after the last of them.
 */
export const FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS: number = 30;

// Why a sign-in failed.
export enum SignInFailureReason {
  WrongPassword = "WrongPassword",
  WrongAuthenticatorCode = "WrongAuthenticatorCode",
  WrongBackupCode = "WrongBackupCode",
  SecurityKeyNotAccepted = "SecurityKeyNotAccepted",
  // The code was not checked: too many wrong ones came before it.
  TooManyWrongCodes = "TooManyWrongCodes",
  AccountBlocked = "AccountBlocked",
  EmailNotVerified = "EmailNotVerified",
  // A password, while the server lets only single sign-on in.
  SingleSignOnRequired = "SingleSignOnRequired",
  // A provider vouched for the person, and OneUptime refused the sign-in.
  SingleSignOnRefused = "SingleSignOnRefused",
}

/*
 * What an entry says of why the sign-in failed: the words the server
 * stores, in English, and keys of the Dashboard's locales, which the table
 * and the dialog draw in the reader's language.
 */
export const SIGN_IN_FAILURE_REASON_DESCRIPTIONS: Readonly<
  Record<SignInFailureReason, string>
> = {
  [SignInFailureReason.WrongPassword]: translationKey("Wrong password"),
  [SignInFailureReason.WrongAuthenticatorCode]: translationKey(
    "Wrong authenticator code",
  ),
  [SignInFailureReason.WrongBackupCode]: translationKey("Wrong backup code"),
  [SignInFailureReason.SecurityKeyNotAccepted]: translationKey(
    "Security key not accepted",
  ),
  [SignInFailureReason.TooManyWrongCodes]: translationKey(
    "Too many wrong codes",
  ),
  [SignInFailureReason.AccountBlocked]: translationKey(
    "Account blocked by a server admin",
  ),
  [SignInFailureReason.EmailNotVerified]: translationKey("Email not verified"),
  [SignInFailureReason.SingleSignOnRequired]: translationKey(
    "Single sign-on required",
  ),
  [SignInFailureReason.SingleSignOnRefused]: translationKey(
    "Single sign-on refused",
  ),
};

export const isSignInFailureReason: (
  reason: unknown,
) => reason is SignInFailureReason = (
  reason: unknown,
): reason is SignInFailureReason => {
  return (
    typeof reason === "string" &&
    (Object.values(SignInFailureReason) as Array<string>).includes(reason)
  );
};

/*
 * One failed sign-in, as core hands it to the audit log recorder
 * (AuditLogService.recordSignInFailures) once the bound has let it through.
 */
export interface SignInFailureAuditEvent {
  // The account the attempt was made on.
  userId: ObjectID;
  // The attempt's own id: each project's entry about it is about the same attempt.
  attemptId: ObjectID;
  reason: SignInFailureReason;
  // How it tried to sign in, and with which provider.
  signIn?: SessionSignIn | null | undefined;
  device?: string | undefined;
  ipAddress?: string | undefined;
  location?: string | undefined;
  /*
   * How many failed attempts on the account the entry stands for: this one,
   * and those counted since the account's last entry that were not
   * recorded one by one. 1 for an attempt recorded on its own.
   */
  failedAttempts: number;
  // When the first of them was made, when the entry stands for more than one.
  firstFailedAt?: Date | undefined;
}
