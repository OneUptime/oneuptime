import crypto from "crypto";
import {
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_EXPIRY_MINUTES,
} from "./ChannelVerification";

/*
 * Telegram's /start payload is a bearer capability: anyone who can guess it
 * can bind their chat to the pending notification method. A six-digit value
 * is therefore not appropriate, even with request throttling. This format
 * carries 256 bits from the operating-system CSPRNG and an authenticated-by-
 * equality issue timestamp, while staying below Telegram's 64-character
 * start-parameter limit.
 *
 *   8 base36 timestamp characters + "_" + 43 base64url characters = 52
 *
 * The whole value is stored on the pending row. Its random portion makes an
 * offline or online search infeasible; the timestamp gives old links a hard
 * lifetime without adding schema columns solely for this channel.
 */

const TOKEN_RANDOM_BYTES: number = 32;
const TOKEN_TIMESTAMP_LENGTH: number = 8;
const TOKEN_RANDOM_LENGTH: number = 43;
const WEBHOOK_SECRET_MIN_LENGTH: number = 32;
const WEBHOOK_SECRET_MAX_LENGTH: number = 100;
const WEBHOOK_SECRET_REGEX: RegExp = /^[A-Za-z0-9_-]+$/;

export const TELEGRAM_VERIFICATION_TOKEN_LENGTH: number =
  TOKEN_TIMESTAMP_LENGTH + 1 + TOKEN_RANDOM_LENGTH;

export const TELEGRAM_VERIFICATION_TOKEN_REGEX: RegExp =
  /^[0-9a-z]{8}_[A-Za-z0-9_-]{43}$/;

export default class TelegramVerificationToken {
  public static mint(now: Date = new Date()): string {
    const issuedAtSeconds: number = Math.floor(now.getTime() / 1000);
    const encodedIssuedAt: string = issuedAtSeconds
      .toString(36)
      .padStart(TOKEN_TIMESTAMP_LENGTH, "0");

    if (encodedIssuedAt.length !== TOKEN_TIMESTAMP_LENGTH) {
      throw new Error("Telegram verification timestamp is out of range");
    }

    const randomValue: string = crypto
      .randomBytes(TOKEN_RANDOM_BYTES)
      .toString("base64url");

    return `${encodedIssuedAt}_${randomValue}`;
  }

  public static isValidShape(token: unknown): token is string {
    return (
      typeof token === "string" &&
      token.length === TELEGRAM_VERIFICATION_TOKEN_LENGTH &&
      TELEGRAM_VERIFICATION_TOKEN_REGEX.test(token)
    );
  }

  public static getIssuedAt(token: unknown): Date | null {
    if (!TelegramVerificationToken.isValidShape(token)) {
      return null;
    }

    const encodedIssuedAt: string = token.slice(0, TOKEN_TIMESTAMP_LENGTH);
    const issuedAtSeconds: number = parseInt(encodedIssuedAt, 36);

    if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) {
      return null;
    }

    return new Date(issuedAtSeconds * 1000);
  }

  public static isExpired(data: {
    token: unknown;
    now?: Date | undefined;
  }): boolean {
    const issuedAt: Date | null = TelegramVerificationToken.getIssuedAt(
      data.token,
    );

    if (!issuedAt) {
      return true;
    }

    const now: Date = data.now || new Date();

    /*
     * A timestamp from the future is malformed or the result of clock skew in
     * the unsafe direction. Refuse it instead of extending the token's life.
     */
    if (issuedAt.getTime() > now.getTime()) {
      return true;
    }

    return (
      now.getTime() - issuedAt.getTime() >=
      VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000
    );
  }

  public static getResendRetryAfterSeconds(data: {
    token: unknown;
    now?: Date | undefined;
  }): number {
    const issuedAt: Date | null = TelegramVerificationToken.getIssuedAt(
      data.token,
    );

    if (!issuedAt) {
      return 0;
    }

    const now: Date = data.now || new Date();
    const elapsedSeconds: number = (now.getTime() - issuedAt.getTime()) / 1000;

    if (elapsedSeconds < 0) {
      return RESEND_COOLDOWN_SECONDS;
    }

    if (elapsedSeconds >= RESEND_COOLDOWN_SECONDS) {
      return 0;
    }

    return Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds));
  }

  /*
   * A non-reversible, fixed-size Redis key segment that never discloses the
   * live bearer token in operational tooling.
   */
  public static getRateLimitKey(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
  }

  /*
   * Burn a token after use. This deliberately does not match the live-token
   * grammar, so no time or random value can make it acceptable again.
   */
  public static mintUnusableValue(): string {
    return crypto.randomBytes(TOKEN_RANDOM_BYTES).toString("hex");
  }

  public static isWebhookSecretStrong(secret: unknown): secret is string {
    if (typeof secret !== "string") {
      return false;
    }

    const normalizedSecret: string = secret.trim();

    return (
      normalizedSecret.length >= WEBHOOK_SECRET_MIN_LENGTH &&
      normalizedSecret.length <= WEBHOOK_SECRET_MAX_LENGTH &&
      WEBHOOK_SECRET_REGEX.test(normalizedSecret)
    );
  }

  /*
   * Fail closed when the administrator did not configure a Telegram webhook
   * secret. Comparing equal-length values with timingSafeEqual avoids turning
   * the header check into a prefix oracle.
   */
  public static isWebhookSecretValid(data: {
    configuredSecret: string | null | undefined;
    providedSecret: string | null | undefined;
  }): boolean {
    const configuredSecret: string = data.configuredSecret?.trim() || "";
    const providedSecret: string = data.providedSecret || "";

    if (!configuredSecret || !providedSecret) {
      return false;
    }

    const configuredBuffer: Buffer = Buffer.from(configuredSecret, "utf8");
    const providedBuffer: Buffer = Buffer.from(providedSecret, "utf8");

    if (configuredBuffer.length !== providedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(configuredBuffer, providedBuffer);
  }
}
