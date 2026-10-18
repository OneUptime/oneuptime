import Redis, { ClientType } from "../Infrastructure/Redis";
import logger from "./Logger";
import ObjectID from "../../Types/ObjectID";

/*
 * WRONG SECOND-STEP CODES, COUNTED FOR THE ACCOUNT.
 *
 * The sign-in limiter (Middleware/IdentityRateLimit) counts attempts per
 * client: per address, per IPv6 /64, and per account together with either.
 * This count holds the ACCOUNT itself: every wrong code entered at the
 * second step of signing in, wherever it came from.
 *
 * THE RULE
 *
 *  - Counted per account, and only once the password is right: the sign-in
 *    routes call startCheck after the password, the block and the verified
 *    address have all been checked. Nobody without the password can move the
 *    count, so nobody without it can make the owner wait.
 *
 *  - The first WRONG_CODES_BEFORE_WAITING wrong codes in a row cost nothing,
 *    so somebody who mistypes signs in as before. After that each next code
 *    waits: FIRST_WAIT_SECONDS after the fifth, twice as long after each
 *    further wrong code, and never longer than LONGEST_WAIT_SECONDS. A wait
 *    rather than a lock: the owner is never shut out for longer than that,
 *    and the codes that can be checked against one account stay a few dozen
 *    a day however many networks they are sent from.
 *
 *  - While the account waits, a code is not checked at all, right or wrong.
 *    Checking it would make the wait no limit on guessing.
 *
 *  - The attempt is counted BEFORE its code is checked (one Lua evaluation:
 *    is the account waiting, and if not, one more wrong code and the wait
 *    that follows it). Two requests sent at the same moment are therefore
 *    two attempts in a row, never two checks inside one wait.
 *
 *  - A sign-in that passes its second step forgets the account's wrong codes
 *    (the code just counted with it), as do a new password and a master
 *    admin's reset of two factor authentication (UserService). Wrong codes
 *    are forgotten on their own a day after the last one.
 *
 *  - The owner is emailed when the waits begin, at most once a day
 *    (shouldTellOwner), at the address on the account.
 *
 * TWO KINDS OF CODE, COUNTED APART
 *
 * Authenticator codes and backup codes each have a count of their own. A
 * backup code is what somebody uses after their authenticator stopped
 * working, so wrong authenticator codes must never make the way back in wait
 * (IdentityRateLimit keeps their per-client counters apart for the same
 * reason). A security key is neither counted nor held: its answer cannot be
 * guessed, so there is nothing for a count to slow down, and the owner keeps
 * a way in that no number of wrong codes can close.
 *
 * FAILS CLOSED
 *
 * With Valkey unreachable no code is checked (CounterUnavailable), as the
 * sign-in limiter in front of these routes already does: without the count
 * nothing bounds the codes checked against an account, and a sign-in cannot
 * finish without Valkey anyway.
 */

export enum TwoFactorCodeKind {
  // A six digit code from an authenticator app.
  AuthenticatorCode = "authenticator-code",

  // A single-use backup code.
  BackupCode = "backup-code",
}

export enum TwoFactorCodeCheckOutcome {
  // The code may be checked now.
  Allowed = "allowed",

  // Too many wrong codes in a row: no code is checked until the wait ends.
  Waiting = "waiting",

  // Valkey cannot be reached, so no code is checked either.
  CounterUnavailable = "counter-unavailable",
}

export interface TwoFactorCodeCheck {
  outcome: TwoFactorCodeCheckOutcome;

  /*
   * Wrong codes in a row: counting the code about to be checked when it is
   * Allowed (it stays counted unless the sign-in succeeds), and the ones so
   * far when Waiting. 0 when the count could not be read.
   */
  wrongCodesInARow: number;

  /*
   * Waiting: seconds until the next code is checked, rounded up. Allowed:
   * how long the next code will wait if this one is wrong. 0 otherwise.
   */
  waitSeconds: number;
}

// Wrong codes in a row that cost nothing; the wait begins after the last of them.
export const WRONG_CODES_BEFORE_WAITING: number = 5;

// The wait after WRONG_CODES_BEFORE_WAITING wrong codes in a row.
export const FIRST_WAIT_SECONDS: number = 60;

// No wait is longer, however many wrong codes came before it.
export const LONGEST_WAIT_SECONDS: number = 60 * 60;

// Wrong codes are forgotten this long after the last one.
export const WRONG_CODES_FORGOTTEN_AFTER_SECONDS: number = 24 * 60 * 60;

// The owner is emailed about wrong codes at most once in this long.
export const OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS: number = 24 * 60 * 60;

const KEY_PREFIX: string = "identity:two-factor-wrong-codes:";

// How often a failing count may be logged.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

/*
 * KEYS[1]: one account's count of one kind of code, a hash of the wrong
 * codes in a row ("wrong") and the time from which the next code may be
 * checked ("nextCheckAt", milliseconds).
 *
 * ARGV: now in milliseconds, WRONG_CODES_BEFORE_WAITING, the first and the
 * longest wait in milliseconds, and the key's lifetime in seconds.
 *
 * Answers {1, wrong codes in a row with this one, the wait that follows it
 * in milliseconds} when the code may be checked, and {0, wrong codes in a
 * row, the milliseconds left to wait} when it may not. A refusal changes
 * nothing, so waiting out a wait is never made longer by asking.
 */
const START_CHECK_SCRIPT: string = [
  "local now = tonumber(ARGV[1])",
  "local nextCheckAt = tonumber(redis.call('HGET', KEYS[1], 'nextCheckAt') or '0')",
  "if nextCheckAt > now then",
  "  return {0, tonumber(redis.call('HGET', KEYS[1], 'wrong') or '0'), nextCheckAt - now}",
  "end",
  "local wrong = redis.call('HINCRBY', KEYS[1], 'wrong', 1)",
  "local before = tonumber(ARGV[2])",
  "local wait = 0",
  "if wrong >= before then",
  "  local doublings = wrong - before",
  "  if doublings > 30 then doublings = 30 end",
  "  wait = tonumber(ARGV[3]) * (2 ^ doublings)",
  "  if wait > tonumber(ARGV[4]) then wait = tonumber(ARGV[4]) end",
  "end",
  "redis.call('HSET', KEYS[1], 'nextCheckAt', string.format('%.0f', now + wait))",
  "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))",
  "return {1, wrong, wait}",
].join("\n");

export default class TwoFactorWrongCodes {
  /*
   * The wait that follows a wrong code, given the wrong codes in a row
   * including it: none for the first few, then FIRST_WAIT_SECONDS, doubling
   * with each further wrong code up to LONGEST_WAIT_SECONDS. The Lua above
   * works it out the same way; TwoFactorWrongCodesValkey.test.ts holds the
   * two together.
   */
  public static getWaitSecondsAfter(wrongCodesInARow: number): number {
    if (wrongCodesInARow < WRONG_CODES_BEFORE_WAITING) {
      return 0;
    }

    const doublings: number = Math.min(
      wrongCodesInARow - WRONG_CODES_BEFORE_WAITING,
      30,
    );

    return Math.min(FIRST_WAIT_SECONDS * 2 ** doublings, LONGEST_WAIT_SECONDS);
  }

  /*
   * Called once the password is right, before a code of `kind` is checked.
   * Refuses while the account waits; otherwise counts this attempt as one
   * more wrong code - which forget() takes back when the sign-in succeeds -
   * and says it may be checked.
   */
  public static async startCheck(data: {
    userId: ObjectID;
    kind: TwoFactorCodeKind;
  }): Promise<TwoFactorCodeCheck> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return TwoFactorWrongCodes.counterUnavailable();
    }

    try {
      const answer: unknown = await client.eval(
        START_CHECK_SCRIPT,
        1,
        TwoFactorWrongCodes.getKey(data.kind, data.userId),
        String(Date.now()),
        String(WRONG_CODES_BEFORE_WAITING),
        String(FIRST_WAIT_SECONDS * 1000),
        String(LONGEST_WAIT_SECONDS * 1000),
        String(WRONG_CODES_FORGOTTEN_AFTER_SECONDS),
      );

      if (
        !Array.isArray(answer) ||
        answer.length !== 3 ||
        !answer.every((value: unknown): boolean => {
          return typeof value === "number" && Number.isFinite(value);
        })
      ) {
        throw new Error("The wrong code count answered something else");
      }

      const [isAllowed, wrongCodesInARow, milliseconds] =
        answer as Array<number>;

      return {
        outcome:
          isAllowed === 1
            ? TwoFactorCodeCheckOutcome.Allowed
            : TwoFactorCodeCheckOutcome.Waiting,
        wrongCodesInARow: wrongCodesInARow as number,
        waitSeconds: Math.max(
          isAllowed === 1 ? 0 : 1,
          Math.ceil((milliseconds as number) / 1000),
        ),
      };
    } catch (err) {
      TwoFactorWrongCodes.logCounterUnavailable(err);

      return TwoFactorWrongCodes.counterUnavailable();
    }
  }

  /*
   * Forgets every wrong code of the account, of both kinds: a sign-in that
   * passed its second step, a new password, a master admin's reset of two
   * factor authentication.
   *
   * Never throws. What calls it has already succeeded - a sign-in, a
   * password change - and must not be undone by a count it could not clear;
   * the count is forgotten on its own a day after the last wrong code.
   */
  public static async forget(userId: ObjectID): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      await client.del(
        TwoFactorWrongCodes.getKey(TwoFactorCodeKind.AuthenticatorCode, userId),
        TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, userId),
      );
    } catch (err) {
      logger.warn(
        `TwoFactorWrongCodes: could not forget the wrong codes of user ${userId.toString()}`,
      );
      logger.warn(err);
    }
  }

  /*
   * Whether to email the owner about wrong codes now. Only once the waits
   * have begun - a mistyped code or two is not news - and at most once a day
   * for the account, whichever kind of code and however many wrong codes
   * follow: the owner is told, and their inbox is not filled. Answers false
   * when Valkey cannot say whether they were told already.
   */
  public static async shouldTellOwner(data: {
    userId: ObjectID;
    wrongCodesInARow: number;
  }): Promise<boolean> {
    if (data.wrongCodesInARow < WRONG_CODES_BEFORE_WAITING) {
      return false;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return false;
    }

    try {
      const answer: unknown = await client.set(
        TwoFactorWrongCodes.getToldKey(data.userId),
        String(Date.now()),
        "EX",
        OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS,
        "NX",
      );

      return answer === "OK";
    } catch (err) {
      TwoFactorWrongCodes.logCounterUnavailable(err);

      return false;
    }
  }

  // "1 minute", "16 minutes", "1 hour": a wait in the words a person reads.
  public static describeWait(seconds: number): string {
    const minutes: number = Math.max(1, Math.ceil(seconds / 60));

    if (minutes >= 60) {
      const hours: number = Math.ceil(minutes / 60);

      return hours === 1 ? "1 hour" : `${hours} hours`;
    }

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  /*
   * What a refused code is answered with. Shown only to somebody who has
   * just entered the account's password, so it may say what is going on.
   */
  public static getWaitingMessage(
    kind: TwoFactorCodeKind,
    waitSeconds: number,
  ): string {
    const wait: string = TwoFactorWrongCodes.describeWait(waitSeconds);

    if (kind === TwoFactorCodeKind.BackupCode) {
      return `Too many wrong backup codes have been entered for this account. Please wait ${wait} before you try another one. If you did not enter these codes, reset your password.`;
    }

    return `Too many wrong codes have been entered for this account. Please wait ${wait} before you try another code, or use a backup code. If you did not enter these codes, reset your password.`;
  }

  /*
   * An account's keys share the hash tag of its id, so on a Valkey cluster
   * they live on one node and forget() removes them in one command.
   */
  public static getKey(kind: TwoFactorCodeKind, userId: ObjectID): string {
    return `${KEY_PREFIX}{${userId.toString()}}:${kind}`;
  }

  public static getToldKey(userId: ObjectID): string {
    return `${KEY_PREFIX}{${userId.toString()}}:owner-told`;
  }

  private static counterUnavailable(): TwoFactorCodeCheck {
    return {
      outcome: TwoFactorCodeCheckOutcome.CounterUnavailable,
      wrongCodesInARow: 0,
      waitSeconds: 0,
    };
  }

  /*
   * Once a minute at most: whatever broke Valkey broke it for every sign-in,
   * and a line per request would bury the incident it reports.
   */
  private static logCounterUnavailable(err: unknown): void {
    const now: number = Date.now();

    if (
      now - TwoFactorWrongCodes.counterUnavailableLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return;
    }

    TwoFactorWrongCodes.counterUnavailableLoggedAt = now;
    logger.warn("TwoFactorWrongCodes: the wrong code count failed");
    logger.warn(err);
  }

  private static counterUnavailableLoggedAt: number = 0;
}
