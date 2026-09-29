import DatabaseService from "../Services/DatabaseService";
import Select from "../Types/Database/Select";
import logger from "./Logger";
import VerificationCode from "./VerificationCode";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * The ownership check shared by every notification channel a user can add to
 * their own account: email, SMS, voice call, WhatsApp and the incoming-call
 * number. Each of those had its own copy of "compare the column, set
 * isVerified", and each copy had the same three holes.
 *
 * WHAT WAS WRONG
 *
 * The code was a stable six-digit value with no expiry, no attempt counter
 * and no lockout. Nothing stops a caller creating a channel row pointing at
 * SOMEBODY ELSE'S address or number - that is the normal, intended flow, it
 * is how you add your own phone - so an authenticated low-privilege user
 * could add a colleague's number and then walk the whole 10^6 code space
 * against /verify at request speed. A million requests is minutes of
 * scripting, and the code at the end of it was still the same code it was at
 * the start. Success marks the row verified, which creates the default
 * notification rules, which makes the victim's phone a delivery target for
 * whatever that project pages about.
 *
 * WHAT REPLACES IT
 *
 * Four controls, each of which has to be defeated on its own:
 *
 *   EXPIRY       a code lives 15 minutes, so the search space is not
 *                available indefinitely.
 *   ATTEMPTS     five wrong guesses per issued code, counted with a single
 *                atomic UPDATE ... RETURNING so racing requests cannot all
 *                read the same pre-increment value and all decide they are
 *                under the limit.
 *   ROTATION     crossing the attempt limit does not merely pause the
 *                attacker with the target still valid behind it - the stored
 *                challenge is burned. Continuing costs a resend, which
 *                notifies the victim.
 *   THROTTLE     resends are on a cooldown, so "burn the code and get a new
 *                one" is not free either, and the victim is not the one who
 *                pays for it in unsolicited messages.
 *
 * On top of that the stored value is a keyed digest rather than the code (see
 * VerificationCode.ts) and the routes are rate limited per user, per row and
 * per address (see Middleware/VerificationCodeRateLimit.ts).
 *
 * Together: five guesses per code, a resend needed for the next five, a
 * cooldown on resends, and every resend visible to the person being attacked.
 */

const parsePositiveIntFromEnv: (envKey: string, fallback: number) => number = (
  envKey: string,
  fallback: number,
): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

/*
 * Long enough to survive a slow SMS carrier, an email that lands in a spam
 * folder the user has to go and look in, or a voice call the user missed and
 * had to wait to be repeated. Short enough that the code space is not
 * standing open. Fifteen minutes is the usual figure for exactly this
 * trade-off and is what the notification copy tells the user.
 */
export const VERIFICATION_CODE_EXPIRY_MINUTES: number = parsePositiveIntFromEnv(
  "NOTIFICATION_VERIFICATION_CODE_EXPIRY_MINUTES",
  15,
);

/*
 * Five is chosen for the human, not the attacker: somebody typing a code off
 * a phone screen will fat-finger it once or twice, and almost never five
 * times. The attacker's number is not five - it is five multiplied by how
 * many resends they are willing to send to their victim's phone, which is the
 * point of the cooldown below.
 */
export const MAX_VERIFICATION_ATTEMPTS: number = parsePositiveIntFromEnv(
  "NOTIFICATION_VERIFICATION_MAX_ATTEMPTS",
  5,
);

/*
 * A resend both issues a fresh code and, for SMS/call/WhatsApp, spends real
 * money sending it to a real handset. The cooldown is the control on the
 * "burn five guesses, resend, repeat" loop AND on using the resend button as
 * a way to text somebody 200 times.
 *
 * Sixty seconds is the interval a user who did not receive the first message
 * will tolerate, and it caps the loop above at five guesses a minute: roughly
 * 200,000 minutes, or four months of uninterrupted attack with a message
 * landing on the victim's phone every sixty seconds of it, for an even chance
 * of hitting one code.
 */
export const RESEND_COOLDOWN_SECONDS: number = parsePositiveIntFromEnv(
  "NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_SECONDS",
  60,
);

/*
 * The verification-related columns every channel model carries. Structural
 * rather than a base class because these are TypeORM entities whose
 * inheritance chain is already spoken for.
 */
export interface VerifiableChannelFields {
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  isVerified?: boolean | undefined;
  verificationCode?: string | undefined;
  verificationCodeExpiresAt?: Date | undefined;
  verificationFailedAttempts?: number | undefined;
  verificationCodeSentAt?: Date | undefined;
}

export type VerifiableChannelModel = BaseModel & VerifiableChannelFields;

export enum ChannelVerificationOutcome {
  Verified = "verified",
  NotFound = "not-found",
  NotOwner = "not-owner",
  AlreadyVerified = "already-verified",
  Expired = "expired",
  TooManyAttempts = "too-many-attempts",
  IncorrectCode = "incorrect-code",
}

export interface ChannelVerificationResult {
  outcome: ChannelVerificationOutcome;

  /*
   * Set only when the outcome is Verified; the rows the caller needs to
   * create the default notification rules.
   */
  itemId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}

/*
 * The slice of a channel service this module actually uses.
 *
 * The five services are DatabaseService<UserEmail>, DatabaseService<UserSMS>
 * and so on, and their write signatures are typed through TypeORM's
 * QueryDeepPartialEntity — a CONDITIONAL type on the entity, which TypeScript
 * cannot resolve while the entity is still a type parameter. Describing the
 * two calls this file makes, and adapting to them once, keeps that problem out
 * of every call site instead of scattering casts through the logic.
 */
interface VerifiableChannelWriter {
  updateOneById(data: {
    id: ObjectID;
    props: { isRoot: boolean };
    data: VerifiableChannelFields;
  }): Promise<number>;

  atomicIncrementColumnValueByOneAndGetValue(data: {
    id: ObjectID;
    columnName: string;
  }): Promise<number>;

  getModel(): { tableName: string | null };
}

const asWriter: (
  service: DatabaseService<VerifiableChannelModel>,
) => VerifiableChannelWriter = (
  service: DatabaseService<VerifiableChannelModel>,
): VerifiableChannelWriter => {
  return service as unknown as VerifiableChannelWriter;
};

export default class ChannelVerification {
  /*
   * When a code issued now stops being accepted.
   */
  public static getExpiresAt(now: Date = new Date()): Date {
    return new Date(
      now.getTime() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
    );
  }

  /*
   * A missing expiry is treated as expired, NOT as "never expires".
   *
   * That is the direction that matters for the rows written before this
   * column existed: they carry a plaintext code and no expiry, and the
   * conservative reading turns them into "request a new code" rather than
   * leaving a permanently valid challenge in place. The cost is that a user
   * who had an unverified channel across the upgrade has to press resend
   * once.
   */
  public static isCodeExpired(data: {
    expiresAt?: Date | null | undefined;
    now?: Date | undefined;
  }): boolean {
    if (!data.expiresAt) {
      return true;
    }

    const now: Date = data.now || new Date();

    return new Date(data.expiresAt).getTime() <= now.getTime();
  }

  /*
   * Seconds the caller must wait before another code may be sent, or 0 if a
   * send is allowed right now.
   */
  public static getResendRetryAfterSeconds(data: {
    lastSentAt?: Date | null | undefined;
    now?: Date | undefined;
  }): number {
    if (!data.lastSentAt) {
      return 0;
    }

    const now: Date = data.now || new Date();
    const elapsedSeconds: number =
      (now.getTime() - new Date(data.lastSentAt).getTime()) / 1000;

    /*
     * A lastSentAt in the future means a clock went backwards, not that the
     * caller may send freely. Treat it as a full cooldown.
     */
    if (elapsedSeconds < 0) {
      return RESEND_COOLDOWN_SECONDS;
    }

    if (elapsedSeconds >= RESEND_COOLDOWN_SECONDS) {
      return 0;
    }

    return Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds));
  }

  /*
   * The column values that put a freshly issued code on a row. Returned
   * rather than written so the caller can fold them into whatever write it
   * was already making, and so the plaintext - which exists in memory for
   * exactly as long as it takes to hand it to the notification service -
   * comes back alongside them.
   */
  public static issueCode(data: {
    channelId: ObjectID;
    now?: Date | undefined;
  }): {
    plainCode: string;
    fields: VerifiableChannelFields;
  } {
    const now: Date = data.now || new Date();
    const plainCode: string = VerificationCode.generate();

    return {
      plainCode,
      fields: {
        verificationCode: VerificationCode.hashCode({
          code: plainCode,
          channelId: data.channelId,
        }),
        verificationCodeExpiresAt: ChannelVerification.getExpiresAt(now),
        verificationCodeSentAt: now,
        verificationFailedAttempts: 0,
      },
    };
  }

  /*
   * The column values that leave a row with NO live challenge on it: a digest
   * no code can produce, and no expiry.
   *
   * `verificationCode` is NOT NULL on every one of these tables, so "there is
   * no code" cannot be written as null. A random 256-bit digest says the same
   * thing and cannot be hit by any of the 10^6 codes.
   */
  public static getClearedCodeFields(): VerifiableChannelFields {
    return {
      verificationCode: VerificationCode.generateUnusableHash(),
      verificationCodeExpiresAt: null as unknown as Date,
    };
  }

  /*
   * Write a fresh code onto an existing row and return the plaintext to send.
   *
   * Callers must have already decided that a send is allowed - this does not
   * check the cooldown, because whether a resend is permitted is a question
   * about the CHANNEL (already verified? project out of SMS credit?) that
   * only the channel's own service can answer.
   */
  public static async issueCodeOnItem<
    TModel extends VerifiableChannelModel,
  >(data: {
    service: DatabaseService<TModel>;
    itemId: ObjectID;
  }): Promise<string> {
    const issued: {
      plainCode: string;
      fields: VerifiableChannelFields;
    } = ChannelVerification.issueCode({ channelId: data.itemId });

    await asWriter(
      data.service as unknown as DatabaseService<VerifiableChannelModel>,
    ).updateOneById({
      id: data.itemId,
      props: {
        isRoot: true,
      },
      data: issued.fields,
    });

    return issued.plainCode;
  }

  /*
   * Check a submitted code and, if it is right, mark the row verified.
   *
   * The ORDER of the steps is the security-relevant part:
   *
   *   ownership first, so one user cannot even probe the state of another
   *   user's row;
   *
   *   already-verified before the counter, so re-submitting a code against a
   *   row that is already done is not a way to burn somebody's attempts;
   *
   *   the lockout gate before the counter, so a row whose budget is already
   *   spent is refused without growing the counter forever and without a
   *   database write per request;
   *
   *   expiry before the counter, because an expired code is refused
   *   unconditionally and there is no reason to spend a user's remaining
   *   attempts telling them so;
   *
   *   the counter before the comparison, so every attempt - including the
   *   ones racing each other - has already consumed its slot by the time
   *   anybody learns whether it was right.
   *
   * The lockout gate reads a value that a concurrent request may already have
   * moved, which is exactly why it is a fast path and not the control. The
   * control is the atomic increment below: N requests that all slip past the
   * stale gate together still receive N DISTINCT attempt numbers, so all but
   * the first MAX_VERIFICATION_ATTEMPTS of them are refused.
   */
  public static async verifyCode<TModel extends VerifiableChannelModel>(data: {
    service: DatabaseService<TModel>;
    itemId: ObjectID;
    userId: ObjectID;
    code: string;
  }): Promise<ChannelVerificationResult> {
    const item: TModel | null = await data.service.findOneById({
      id: data.itemId,
      props: {
        isRoot: true,
      },
      select: {
        userId: true,
        projectId: true,
        isVerified: true,
        verificationCode: true,
        verificationCodeExpiresAt: true,
        verificationFailedAttempts: true,
      } as Select<TModel>,
    });

    const writer: VerifiableChannelWriter = asWriter(
      data.service as unknown as DatabaseService<VerifiableChannelModel>,
    );

    if (!item) {
      return { outcome: ChannelVerificationOutcome.NotFound };
    }

    if (item.userId?.toString() !== data.userId.toString()) {
      return { outcome: ChannelVerificationOutcome.NotOwner };
    }

    if (item.isVerified) {
      return { outcome: ChannelVerificationOutcome.AlreadyVerified };
    }

    if ((item.verificationFailedAttempts || 0) >= MAX_VERIFICATION_ATTEMPTS) {
      return { outcome: ChannelVerificationOutcome.TooManyAttempts };
    }

    if (
      ChannelVerification.isCodeExpired({
        expiresAt: item.verificationCodeExpiresAt,
      })
    ) {
      return { outcome: ChannelVerificationOutcome.Expired };
    }

    const attemptNumber: number =
      await writer.atomicIncrementColumnValueByOneAndGetValue({
        id: data.itemId,
        columnName: "verificationFailedAttempts",
      });

    /*
     * Only reachable when requests raced past the gate above together. They
     * are refused here rather than being given a comparison, and the request
     * holding attempt number MAX_VERIFICATION_ATTEMPTS still burns the
     * challenge below.
     */
    if (attemptNumber > MAX_VERIFICATION_ATTEMPTS) {
      return { outcome: ChannelVerificationOutcome.TooManyAttempts };
    }

    const submittedHash: string = VerificationCode.hashCode({
      code: String(data.code),
      channelId: data.itemId,
    });

    if (
      !VerificationCode.isHashEqual(submittedHash, item.verificationCode || "")
    ) {
      /*
       * That was the last attempt this code gets, so burn it now rather than
       * leave a spent-but-still-valid challenge on the row. The attacker's
       * next move has to be a resend, which costs them the cooldown and tells
       * the victim what is happening.
       *
       * Done exactly once, on the attempt that exhausts the budget; every
       * later request is turned away by the gate above without a write.
       */
      if (attemptNumber >= MAX_VERIFICATION_ATTEMPTS) {
        await writer.updateOneById({
          id: data.itemId,
          props: {
            isRoot: true,
          },
          data: ChannelVerification.getClearedCodeFields(),
        });

        logger.warn(
          `ChannelVerification: attempt limit reached on ${writer.getModel().tableName} ${data.itemId.toString()} for user ${data.userId.toString()}; verification code invalidated`,
        );
      }

      return { outcome: ChannelVerificationOutcome.IncorrectCode };
    }

    /*
     * Correct. Mark verified AND clear the challenge in the same write: a
     * used code must not remain usable, and the attempt counter goes back to
     * zero so a later re-issue (if the row is ever un-verified) starts fresh.
     */
    await writer.updateOneById({
      id: data.itemId,
      props: {
        isRoot: true,
      },
      data: {
        isVerified: true,
        verificationFailedAttempts: 0,
        ...ChannelVerification.getClearedCodeFields(),
      },
    });

    return {
      outcome: ChannelVerificationOutcome.Verified,
      itemId: data.itemId,
      userId: item.userId,
      projectId: item.projectId,
    };
  }

  /*
   * The message a failed outcome is reported to the caller with.
   *
   * IncorrectCode and NotFound deliberately do NOT say anything the caller
   * did not already know, and every failure is a plain BadDataException so
   * the shape of the response does not vary with the reason either.
   */
  public static getFailureException(
    outcome: ChannelVerificationOutcome,
  ): BadDataException {
    switch (outcome) {
      case ChannelVerificationOutcome.NotFound:
        return new BadDataException("Item not found");
      case ChannelVerificationOutcome.NotOwner:
        return new BadDataException("Invalid user ID");
      case ChannelVerificationOutcome.AlreadyVerified:
        return new BadDataException("This is already verified");
      case ChannelVerificationOutcome.Expired:
        return new BadDataException(
          "This verification code has expired. Please request a new code.",
        );
      case ChannelVerificationOutcome.TooManyAttempts:
        return new BadDataException(
          "Too many incorrect attempts. This verification code is no longer valid. Please request a new code.",
        );
      default:
        return new BadDataException("Invalid code");
    }
  }
}
