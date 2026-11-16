import Redis, { ClientType } from "../../Infrastructure/Redis";
import AuditLogService from "../../Services/AuditLogService";
import logger from "../Logger";
import RequestOriginUtil, {
  RequestOriginRequestLike,
} from "../RequestOrigin/RequestOriginUtil";
import {
  FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS,
  FAILED_SIGN_IN_WINDOW_IN_MINUTES,
  FAILED_SIGN_INS_RECORDED_PER_WINDOW,
  SignInFailureAuditEvent,
  SignInFailureReason,
} from "../../../Types/AuditLog/AuditLogSignInFailure";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import { SessionSignIn } from "../../../Types/UserSession/SessionSignIn";

/*
 * FAILED SIGN-INS, INTO THE AUDIT LOG, WITHOUT TELLING ANYONE ELSE
 * (issue #6788, Types/AuditLog/AuditLogSignInFailure).
 *
 * The sign-in routes call record() once they know an attempt on an existing
 * account failed. Three things hold, whatever happens here:
 *
 *  - THE PERSON SIGNING IN LEARNS NOTHING. record() returns at once and
 *    does nothing before the route has answered: the counting, the reads of
 *    the account's projects and the write run after, on their own, and
 *    whatever they find or however they fail changes neither the answer nor
 *    how long it takes. An attempt on an address nobody has is never
 *    recorded, so an answer that waited for the audit log would tell a
 *    stranger the account exists. Nor is anything the person typed kept:
 *    the password, a code, a token - only why it failed, how they tried,
 *    and where the request came from, as OneUptime reads it
 *    (RequestOriginUtil).
 *
 *  - A FLOOD CANNOT FILL THE AUDIT LOG. Anyone who knows an address can
 *    make failed attempts, from as many networks as they like (the sign-in
 *    limiter counts per client: Middleware/IdentityRateLimit), and each one
 *    recorded lands in every project of the account's person. So the
 *    account itself is counted, wherever its attempts come from, in Valkey
 *    (one Lua evaluation, so two attempts at once are counted in turn):
 *    FAILED_SIGN_INS_RECORDED_PER_WINDOW are recorded one by one in each
 *    FAILED_SIGN_IN_WINDOW_IN_MINUTES, and the rest are counted for the
 *    account's next entry, which says how many attempts it stands for and
 *    when the first of them was. The count is forgotten
 *    FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS after the last attempt.
 *
 *  - NOTHING IS COUNTED WHERE NOTHING RECORDS: on the Community Edition,
 *    which has no audit log recorder, an attempt costs no Valkey call. With
 *    Valkey unreachable nothing is recorded: the bound cannot be kept, and
 *    the sign-in limiter in front of these routes refuses every attempt
 *    then anyway (it fails closed).
 */

// Where a request came from, kept while the request is still open.
type RequestOriginSnapshot = RequestOriginRequestLike;

export interface FailedSignInInput {
  // The request the attempt came in on.
  req: RequestOriginRequestLike;
  // The account the attempt was made on.
  userId: ObjectID;
  reason: SignInFailureReason;
  // How it tried to sign in: a password, a link, single sign-on and its provider.
  signIn?: SessionSignIn | undefined;
}

// What the count of an account's failed attempts says of the one just made.
export interface FailedSignInCount {
  // Whether this attempt is recorded now.
  isRecorded: boolean;
  /*
   * How many attempts an entry recorded now stands for - this one and the
   * ones counted since the account's last entry - or, when this one is not
   * recorded, how many wait for the next entry, this one included.
   */
  attempts: number;
  // When the first of those attempts was made.
  firstAttemptAt: Date;
}

const KEY_PREFIX: string = "audit-log:failed-sign-ins:";

// How often a failing count may be logged.
const FAILURE_LOG_INTERVAL_MS: number = 60 * 1000;

/*
 * KEYS[1]: one account's count, a hash of the window's start ("windowStart",
 * milliseconds), the attempts recorded in it ("recorded"), the attempts
 * counted but not recorded since the account's last entry ("pending") and
 * when the first of those was made ("pendingSince", milliseconds).
 *
 * ARGV: now in milliseconds, the window in milliseconds, the attempts
 * recorded one by one in a window, and the key's lifetime in seconds.
 *
 * A window starts at the first attempt after the last one ended. Answers
 * {1, attempts the entry stands for, when the first of them was} when the
 * attempt is recorded - the pending ones are then handed to it - and {0,
 * attempts pending with this one, when the first of them was} when it is
 * only counted.
 */
const COUNT_ATTEMPT_SCRIPT: string = [
  "local now = tonumber(ARGV[1])",
  "local windowMs = tonumber(ARGV[2])",
  "local perWindow = tonumber(ARGV[3])",
  "local windowStart = tonumber(redis.call('HGET', KEYS[1], 'windowStart') or '-1')",
  "local recorded = tonumber(redis.call('HGET', KEYS[1], 'recorded') or '0')",
  "if windowStart < 0 or now - windowStart >= windowMs then",
  "  windowStart = now",
  "  recorded = 0",
  "end",
  "local pending = tonumber(redis.call('HGET', KEYS[1], 'pending') or '0') + 1",
  "local pendingSince = now",
  "if pending > 1 then",
  "  pendingSince = tonumber(redis.call('HGET', KEYS[1], 'pendingSince') or ARGV[1])",
  "end",
  "local isRecorded = 0",
  "if recorded < perWindow then",
  "  isRecorded = 1",
  "  recorded = recorded + 1",
  "  redis.call('HSET', KEYS[1], 'windowStart', string.format('%.0f', windowStart), 'recorded', recorded, 'pending', 0, 'pendingSince', '0')",
  "else",
  "  redis.call('HSET', KEYS[1], 'windowStart', string.format('%.0f', windowStart), 'recorded', recorded, 'pending', pending, 'pendingSince', string.format('%.0f', pendingSince))",
  "end",
  "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))",
  "return {isRecorded, pending, pendingSince}",
].join("\n");

export default class FailedSignInAuditLog {
  /*
   * Records a failed attempt on an existing account, once the route that
   * refused it has answered: returns at once, never throws, and nothing it
   * does reaches the answer. Only where the request came from is kept now,
   * while the request is open.
   */
  public static record(input: FailedSignInInput): void {
    try {
      const req: RequestOriginSnapshot = FailedSignInAuditLog.keepOrigin(
        input.req,
      );

      setImmediate((): void => {
        FailedSignInAuditLog.recordNow({ ...input, req }).catch(
          (err: unknown): void => {
            FailedSignInAuditLog.logFailure(err);
          },
        );
      });
    } catch (err) {
      FailedSignInAuditLog.logFailure(err);
    }
  }

  /*
   * The work record() leaves for after the answer: the count, and the entry
   * when the count lets it through. Never throws.
   */
  public static async recordNow(input: FailedSignInInput): Promise<void> {
    try {
      if (!AuditLogService.hasRecorder()) {
        return;
      }

      const count: FailedSignInCount | null =
        await FailedSignInAuditLog.countAttempt({
          userId: input.userId,
          now: OneUptimeDate.getCurrentDate(),
        });

      if (!count || !count.isRecorded) {
        return;
      }

      const origin: RequestOrigin = RequestOriginUtil.fromRequest(input.req);

      const event: SignInFailureAuditEvent = {
        userId: input.userId,
        attemptId: ObjectID.generate(),
        reason: input.reason,
        signIn: input.signIn,
        device: origin.device,
        ipAddress: origin.ipAddress,
        location: origin.location,
        failedAttempts: count.attempts,
      };

      if (count.attempts > 1) {
        event.firstFailedAt = count.firstAttemptAt;
      }

      await AuditLogService.recordSignInFailures([event]);
    } catch (err) {
      FailedSignInAuditLog.logFailure(err);
    }
  }

  /*
   * Counts one failed attempt on the account and says whether it is
   * recorded (COUNT_ATTEMPT_SCRIPT), or null when Valkey cannot say: the
   * attempt is then not recorded.
   */
  public static async countAttempt(data: {
    userId: ObjectID;
    now: Date;
  }): Promise<FailedSignInCount | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    try {
      const answer: unknown = await client.eval(
        COUNT_ATTEMPT_SCRIPT,
        1,
        FailedSignInAuditLog.getKey(data.userId),
        String(data.now.getTime()),
        String(FAILED_SIGN_IN_WINDOW_IN_MINUTES * 60 * 1000),
        String(FAILED_SIGN_INS_RECORDED_PER_WINDOW),
        String(FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS * 24 * 60 * 60),
      );

      return FailedSignInAuditLog.readCount(answer);
    } catch (err) {
      FailedSignInAuditLog.logFailure(err);

      return null;
    }
  }

  // What the script answered, or null for an answer it cannot have given.
  public static readCount(answer: unknown): FailedSignInCount | null {
    if (
      !Array.isArray(answer) ||
      answer.length !== 3 ||
      !answer.every((value: unknown): boolean => {
        return typeof value === "number" && Number.isSafeInteger(value);
      })
    ) {
      return null;
    }

    const [isRecorded, attempts, firstAttemptAtMs] = answer as Array<number>;

    if ((attempts as number) < 1 || (firstAttemptAtMs as number) <= 0) {
      return null;
    }

    return {
      isRecorded: isRecorded === 1,
      attempts: attempts as number,
      firstAttemptAt: new Date(firstAttemptAtMs as number),
    };
  }

  /*
   * An account's count, under the hash tag of its id: on a Valkey cluster
   * it lives on one node, as every key of the account's does.
   */
  public static getKey(userId: ObjectID): string {
    return `${KEY_PREFIX}{${userId.toString()}}`;
  }

  /*
   * What RequestOriginUtil reads of a request - its headers and the peer's
   * address - kept from the request itself: the socket's address is gone
   * once its connection closes, which can be before the entry is written.
   */
  private static keepOrigin(
    req: RequestOriginRequestLike,
  ): RequestOriginSnapshot {
    return {
      headers: req.headers || {},
      socket: { remoteAddress: req.socket?.remoteAddress },
      ip: req.ip,
    } as RequestOriginSnapshot;
  }

  /*
   * Once a minute at most: whatever broke the recording broke it for every
   * failed sign-in, and a line per attempt would bury the incident.
   */
  private static logFailure(err: unknown): void {
    const now: number = Date.now();

    if (now - FailedSignInAuditLog.failureLoggedAt < FAILURE_LOG_INTERVAL_MS) {
      return;
    }

    FailedSignInAuditLog.failureLoggedAt = now;
    logger.warn("FailedSignInAuditLog: could not record a failed sign-in");
    logger.warn(err);
  }

  private static failureLoggedAt: number = 0;
}
