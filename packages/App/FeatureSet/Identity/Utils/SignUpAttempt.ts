import { randomBytes } from "crypto";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import ObjectID from "Common/Types/ObjectID";
import { VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS } from "./VerificationEmailResendToken";

/*
 * WHAT A SIGN-UP DID WITH AN ADDRESS, KEPT FOR ITS RESEND BUTTON (#9816).
 *
 * A sign-up that can email its address answers every address alike - "check
 * your email" - and acts on the address only after it has answered:
 *
 *   - no account: one is created, and its welcome asks to verify the address;
 *   - an account that has signed up: its owner is told someone tried to sign
 *     up with their address, with a way to sign in and to reset the password;
 *   - an account nobody has signed up to yet (an invitation): its link to
 *     finish setting up.
 *
 * Which of these it was is kept here, on the server, for a day, under a
 * random id the sign-up's resend credential carries
 * (VerificationEmailResendToken.generateForSignUp). The credential says
 * nothing about it, so the button behaves alike for every address; the
 * server reads what to send again when it is pressed. Each resend's time is
 * kept with it, for the credential's own caps (VerificationEmailResendPolicy).
 *
 * In the cache (Redis), not Postgres: it outlives nothing it describes, and a
 * cache that has lost it costs the button, never the account - the resend
 * route then answers as for any credential it does not know, and signing in
 * or signing up again still sends what is needed.
 */

export enum SignUpAttemptKind {
  // No account had the address: this sign-up created one.
  NewAccount = "new-account",
  // An account that has signed up had it: its owner was told.
  ExistingAccount = "existing-account",
  // An account nobody has signed up to yet had it: its link was sent.
  UnclaimedAccount = "unclaimed-account",
}

export interface SignUpAttemptRecord {
  userId: ObjectID;
  kind: SignUpAttemptKind;
  // When this attempt's email was sent again, oldest first.
  resentAt: Array<Date>;
}

const NAMESPACE: string = "identity-sign-up-attempt";

// Far more than any cap allows (three resends a credential).
const MAX_RESENDS_KEPT: number = 20;

const KINDS: Array<string> = Object.values(SignUpAttemptKind);

export default class SignUpAttempt {
  // A new attempt's id: 32 random bytes, which nobody can guess.
  public static newAttemptId(): string {
    return randomBytes(32).toString("base64url");
  }

  // What this attempt did, kept for as long as its credential works.
  public static async record(data: {
    attemptId: string;
    userId: ObjectID;
    kind: SignUpAttemptKind;
  }): Promise<void> {
    await SignUpAttempt.write(
      data.attemptId,
      {
        userId: data.userId,
        kind: data.kind,
        resentAt: [],
      },
      VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS,
    );
  }

  /*
   * What the attempt did, or null when nothing is kept for it: an id no
   * attempt had, a day gone by, or a cache that lost it. Throws
   * DatabaseNotConnectedException while the cache cannot be reached, which
   * the resend route answers as it answers its fence's.
   */
  public static async read(
    attemptId: string,
  ): Promise<SignUpAttemptRecord | null> {
    const stored: string | null = await GlobalCache.getString(
      NAMESPACE,
      attemptId,
    );

    if (!stored) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(stored);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }

      const record: Record<string, unknown> = parsed as Record<string, unknown>;
      const userId: unknown = record["u"];
      const kind: unknown = record["k"];
      const resentAt: unknown = record["r"];

      if (
        typeof userId !== "string" ||
        !ObjectID.isValidUUID(userId) ||
        typeof kind !== "string" ||
        !KINDS.includes(kind) ||
        !Array.isArray(resentAt)
      ) {
        return null;
      }

      return {
        userId: new ObjectID(userId),
        kind: kind as SignUpAttemptKind,
        resentAt: resentAt
          .filter((time: unknown): time is number => {
            return typeof time === "number" && Number.isSafeInteger(time);
          })
          .map((time: number): Date => {
            return new Date(time);
          }),
      };
    } catch {
      return null;
    }
  }

  /*
   * A resend of this attempt's email, at `at`. Kept until the credential
   * stops working: `expiresAt`, its own expiry.
   */
  public static async noteResend(data: {
    attemptId: string;
    record: SignUpAttemptRecord;
    at: Date;
    expiresAt: Date;
  }): Promise<void> {
    const secondsLeft: number = Math.ceil(
      (data.expiresAt.getTime() - data.at.getTime()) / 1000,
    );

    if (secondsLeft <= 0) {
      return;
    }

    await SignUpAttempt.write(
      data.attemptId,
      {
        ...data.record,
        resentAt: [...data.record.resentAt, data.at].slice(-MAX_RESENDS_KEPT),
      },
      secondsLeft,
    );
  }

  private static async write(
    attemptId: string,
    record: SignUpAttemptRecord,
    expiresInSeconds: number,
  ): Promise<void> {
    await GlobalCache.setString(
      NAMESPACE,
      attemptId,
      JSON.stringify({
        u: record.userId.toString(),
        k: record.kind,
        r: record.resentAt.map((time: Date): number => {
          return time.getTime();
        }),
      }),
      { expiresInSeconds: expiresInSeconds },
    );
  }
}
