/*
 * How often an unverified account may be sent a fresh verification link
 * through POST /identity/resend-verification-email
 * (App/FeatureSet/Identity/API/Authentication.ts).
 *
 * Pure on purpose: no clock, no database, no crypto, no environment. The route
 * reads the send history (the createdAt of the account's EmailVerificationToken
 * rows) and the current time, and this file only decides. That keeps every
 * boundary below testable to the millisecond and keeps the decision identical
 * on every pod that might answer the same user.
 *
 * WHAT IS BEING BOUNDED
 *
 * The route mails somebody. The only address it ever mails is the one stored
 * on the account, so a caller cannot aim it at a stranger -- but they can
 * still aim it at the account's own inbox as often as the server lets them,
 * and every one of those mails costs sender reputation and annoys a person.
 * Three independent limits, each covering a hole the others leave:
 *
 *  - a COOLDOWN between consecutive sends, so a double click, a reload loop or
 *    an impatient user produces one mail rather than a burst;
 *
 *  - a WINDOW cap, so somebody who waits out every cooldown still cannot turn
 *    the route into a steady drip of a mail a minute;
 *
 *  - a PER-CREDENTIAL cap, so a single credential -- the resend token handed out
 *    at signup, or one verification link -- buys a small, fixed number of mails
 *    and then stops working. The signup captcha is what makes a credential
 *    expensive to obtain; this is what stops one solved captcha being worth an
 *    unbounded amount of mail over the credential's whole lifetime.
 *
 * Every row counts, whatever flow created it. A sign-in attempt on an
 * unverified account, an invitation, an SSO confirmation and this route all
 * write to the same table, and from the recipient's point of view they are
 * all "another email from OneUptime". Counting only this route's own sends
 * would let the flows add up to more than any one of them allows.
 */

export const VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS: number = 60;
export const VERIFICATION_EMAILS_PER_WINDOW_LIMIT: number = 5;
export const VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS: number = 60 * 60;

/* How many verification mails may be created for the account after a credential was issued before that credential stops working. */
export const VERIFICATION_EMAIL_RESENDS_PER_CREDENTIAL_LIMIT: number = 3;

/* Emailed verification tokens older than this cannot request a new link. */
export const VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS: number = 14;

/*
 * The one refusal every invalid request gets, whatever was wrong with it.
 *
 * A route that said "unknown token" to one caller, "wrong address" to another
 * and "used up" to a third would be an oracle for which tokens and accounts
 * exist. It points at the recovery path that always works for the account
 * owner: signing in with the password mails a fresh link (see login() in
 * Authentication.ts).
 */
export const VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE: string =
  "This verification request is no longer valid. Sign in with your email and password and we will send you a new verification link.";

export enum VerificationEmailResendDecisionType {
  Allowed = "allowed",

  /* Too soon. `retryAfterSeconds` says when the next send would be allowed. */
  CoolingDown = "cooling-down",

  /*
   * The credential has bought all the mail it is ever going to buy. Refused
   * with the same message as every other invalid request, so the caller
   * cannot tell a spent credential from a forged one.
   */
  CredentialExhausted = "credential-exhausted",
}

export interface VerificationEmailResendDecision {
  type: VerificationEmailResendDecisionType;
  retryAfterSeconds: number;
}

const MILLISECONDS_IN_SECOND: number = 1000;

const isValidDate: (value: unknown) => boolean = (value: unknown): boolean => {
  return value instanceof Date && !Number.isNaN(value.getTime());
};

export default class VerificationEmailResendPolicy {
  public static evaluate(data: {
    /*
     * createdAt of this account's EmailVerificationToken rows, in any order.
     * May include rows older than any window below; they are ignored where
     * they do not matter.
     */
    sendTimes: Array<Date>;

    /*
     * When the credential presented with this request came into existence:
     * the resend token's `i` claim, or the createdAt of the verification
     * token row whose link is being used.
     */
    credentialIssuedAt: Date;

    now: Date;
    cooldownInSeconds?: number | undefined;
    perWindowLimit?: number | undefined;
    windowInSeconds?: number | undefined;
    perCredentialLimit?: number | undefined;
  }): VerificationEmailResendDecision {
    const cooldownInSeconds: number =
      data.cooldownInSeconds ?? VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS;
    const perWindowLimit: number =
      data.perWindowLimit ?? VERIFICATION_EMAILS_PER_WINDOW_LIMIT;
    const windowInSeconds: number =
      data.windowInSeconds ?? VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS;
    const perCredentialLimit: number =
      data.perCredentialLimit ??
      VERIFICATION_EMAIL_RESENDS_PER_CREDENTIAL_LIMIT;

    /*
     * Neither of these can come from a well-behaved caller, and both fail
     * CLOSED. Without a usable clock no interval can be measured, so the
     * answer is "wait"; without a usable issuance time nothing can be counted
     * against the credential, and a credential whose sends cannot be counted
     * is a credential with no cap -- so it is treated as spent.
     */
    if (!isValidDate(data.now)) {
      return {
        type: VerificationEmailResendDecisionType.CoolingDown,
        retryAfterSeconds: Math.max(1, Math.ceil(cooldownInSeconds)),
      };
    }

    if (!isValidDate(data.credentialIssuedAt)) {
      return {
        type: VerificationEmailResendDecisionType.CredentialExhausted,
        retryAfterSeconds: 0,
      };
    }

    const nowMs: number = data.now.getTime();
    const credentialIssuedAtMs: number = data.credentialIssuedAt.getTime();

    /*
     * A send time in the future is a clock disagreement between the database
     * and this process (createdAt is stamped by Postgres, `now` by Node), not
     * a send that has not happened yet. Treating it as "just now" keeps the
     * cooldown from growing past its own length and the window from holding a
     * row longer than the window.
     */
    const sendTimesMs: Array<number> = (
      Array.isArray(data.sendTimes) ? data.sendTimes : []
    )
      .filter((sendTime: Date) => {
        return isValidDate(sendTime);
      })
      .map((sendTime: Date) => {
        return Math.min(sendTime.getTime(), nowMs);
      });

    /*
     * 1. Per-credential cap. STRICTLY after issuance: the send that the
     * credential was minted alongside (the welcome mail, or the mail that
     * carried the link) is not one of the resends it buys.
     */
    const sendsSinceCredential: number = sendTimesMs.filter(
      (sendTimeMs: number) => {
        return sendTimeMs > credentialIssuedAtMs;
      },
    ).length;

    if (sendsSinceCredential >= perCredentialLimit) {
      return {
        type: VerificationEmailResendDecisionType.CredentialExhausted,
        retryAfterSeconds: 0,
      };
    }

    // 2. Cooldown since the most recent send of any kind.
    let cooldownRetryAfterSeconds: number = 0;

    if (sendTimesMs.length > 0) {
      // A reduce rather than Math.max(...spread), which has an argument limit.
      const latestSendMs: number = sendTimesMs.reduce(
        (latest: number, sendTimeMs: number) => {
          return Math.max(latest, sendTimeMs);
        },
        Number.NEGATIVE_INFINITY,
      );
      const elapsedSeconds: number =
        (nowMs - latestSendMs) / MILLISECONDS_IN_SECOND;

      if (elapsedSeconds < cooldownInSeconds) {
        cooldownRetryAfterSeconds = Math.max(
          1,
          Math.ceil(cooldownInSeconds - elapsedSeconds),
        );
      }
    }

    /*
     * 3. Window cap. When the window is full, the next send becomes possible
     * the moment enough of the oldest sends age out to leave room for one
     * more -- which is when the send `perWindowLimit` places from the newest
     * leaves the window.
     */
    let windowRetryAfterSeconds: number = 0;

    const sendsInWindowMs: Array<number> = sendTimesMs
      .filter((sendTimeMs: number) => {
        return (nowMs - sendTimeMs) / MILLISECONDS_IN_SECOND < windowInSeconds;
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    if (sendsInWindowMs.length >= perWindowLimit) {
      const pivotMs: number | undefined =
        sendsInWindowMs[sendsInWindowMs.length - perWindowLimit];

      /*
       * Only undefined for a limit of zero or less, which allows nothing: the
       * oldest send in the window is then the best available answer.
       */
      const effectivePivotMs: number = pivotMs ?? sendsInWindowMs[0] ?? nowMs;

      windowRetryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (effectivePivotMs +
            windowInSeconds * MILLISECONDS_IN_SECOND -
            nowMs) /
            MILLISECONDS_IN_SECOND,
        ),
      );
    }

    // 4. The later of the two is when a send would actually be allowed.
    const retryAfterSeconds: number = Math.max(
      cooldownRetryAfterSeconds,
      windowRetryAfterSeconds,
    );

    if (retryAfterSeconds > 0) {
      return {
        type: VerificationEmailResendDecisionType.CoolingDown,
        retryAfterSeconds,
      };
    }

    return {
      type: VerificationEmailResendDecisionType.Allowed,
      retryAfterSeconds: 0,
    };
  }
}
