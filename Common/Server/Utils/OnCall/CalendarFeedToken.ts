import crypto from "crypto";
import OneUptimeDate from "../../../Types/Date";
import { PREVIOUS_TOKEN_GRACE_DAYS } from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";

/*
 * The capability token that addresses an on-call calendar feed.
 *
 * A calendar client keeps the feed URL forever and re-fetches it unattended,
 * so the token has to be both unguessable and cheap to look up: 256 bits from
 * the CSPRNG, carried in the URL as base64url (43 characters, no padding), and
 * stored ONLY as its unkeyed SHA-256 hex digest. The digest is what the public
 * route queries by, which keeps the plaintext out of the indexed column; a
 * database dump therefore yields hashes, not working feed URLs.
 *
 * Unkeyed on purpose: a keyed hash (HMAC over EncryptionSecret, the backup-code
 * recipe) would tie every feed to the instance secret, and rotating that secret
 * would silently break every subscribed calendar in the world with no way to
 * tell the user. The token already carries 256 bits of entropy, so a rainbow
 * table buys nothing and the key adds no strength worth that failure mode.
 *
 * The hint is the last four characters - enough for the settings page to say
 * "link ending in …k3Qx" so a user can tell two links apart, far too little to
 * recover anything.
 */

// crypto.randomBytes(32) -> 32 bytes -> ceil(32 * 8 / 6) = 43 base64url chars.
const TOKEN_BYTE_LENGTH: number = 32;

export const CALENDAR_FEED_TOKEN_LENGTH: number = 43;

export const CALENDAR_FEED_TOKEN_HINT_LENGTH: number = 4;

/*
 * Shape guard for the public route. Anything that does not match is answered
 * 404 before any database work, so a scanner probing the path costs one regex.
 */
export const CALENDAR_FEED_TOKEN_REGEX: RegExp = /^[A-Za-z0-9_-]{43}$/;

export interface MintedCalendarFeedToken {
  /** The plaintext token. Goes into the URL and, encrypted, into `token`. */
  token: string;
  /** Unkeyed SHA-256 hex digest of the token. The indexed lookup column. */
  tokenHash: string;
  /** Last four characters of the token, for display only. */
  tokenHint: string;
}

/*
 * Everything a feed row's token columns hold after a rotation: the new
 * token set, when it was minted, and the rotated-out hash with the instant
 * it stops being honoured. `previousTokenHash` is null when there was no
 * token before (a first mint), so a fresh feed never carries a grace entry.
 */
export interface CalendarFeedRotation extends MintedCalendarFeedToken {
  rotatedAt: Date;
  previousTokenHash: string | null;
  previousTokenExpiresAt: Date | null;
}

/*
 * The token columns every feed model carries (UserOnCallCalendarFeed,
 * OnCallDutyPolicyScheduleCalendarFeed, ProjectOnCallCalendarFeed). Typed
 * structurally so the three services share one rule without a common base.
 */
export interface CalendarFeedTokenColumns {
  token?: string | undefined;
  tokenHash?: string | undefined;
  tokenHint?: string | undefined;
  rotatedAt?: Date | undefined;
  previousTokenHash?: string | undefined;
  previousTokenExpiresAt?: Date | undefined;
}

export interface CalendarFeedRotationUpdateData {
  token: string;
  tokenHash: string;
  tokenHint: string;
  rotatedAt: Date;
  previousTokenHash: string;
  previousTokenExpiresAt: Date;
}

export default class CalendarFeedToken {
  /**
   * A fresh 43-character base64url token from 32 CSPRNG bytes.
   */
  public static mint(): string {
    return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
  }

  /**
   * Unkeyed SHA-256 of the token, lowercase hex (64 characters). This is the
   * value stored in `tokenHash` / `previousTokenHash` and the value the public
   * route looks up by. Deterministic: the same token always hashes the same.
   */
  public static hash(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
  }

  /**
   * The display hint - the last four characters of the token. Never enough to
   * reconstruct the token; enough to tell "…k3Qx" from "…Q9zA" in the UI.
   */
  public static hint(token: string): string {
    return token.slice(-CALENDAR_FEED_TOKEN_HINT_LENGTH);
  }

  /**
   * True when the string has exactly the shape a minted token has. Used as
   * the shape guard on the public route so a malformed path never reaches the
   * database.
   */
  public static isValidShape(token: unknown): token is string {
    return typeof token === "string" && CALENDAR_FEED_TOKEN_REGEX.test(token);
  }

  /**
   * Everything a feed row needs when a token is minted or rotated.
   */
  public static mintSet(): MintedCalendarFeedToken {
    const token: string = CalendarFeedToken.mint();

    return {
      token: token,
      tokenHash: CalendarFeedToken.hash(token),
      tokenHint: CalendarFeedToken.hint(token),
    };
  }

  /**
   * The token columns a feed row should hold after minting or rotating.
   *
   * The hash the row held before (if any) moves to `previousTokenHash` and
   * keeps serving an EMPTY calendar until `previousTokenExpiresAt`
   * (PREVIOUS_TOKEN_GRACE_DAYS from now), so a still-subscribed client clears
   * its copy instead of showing "could not fetch" until the user notices.
   */
  public static buildRotation(data: {
    currentTokenHash: string | null | undefined;
    now?: Date | undefined;
  }): CalendarFeedRotation {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const minted: MintedCalendarFeedToken = CalendarFeedToken.mintSet();

    const previousTokenHash: string | null = data.currentTokenHash || null;

    return {
      ...minted,
      rotatedAt: now,
      previousTokenHash: previousTokenHash,
      previousTokenExpiresAt: previousTokenHash
        ? OneUptimeDate.addRemoveDays(now, PREVIOUS_TOKEN_GRACE_DAYS)
        : null,
    };
  }

  /**
   * Populate the token columns of a row about to be INSERTED.
   *
   * With `trustSuppliedToken`, a well-formed plaintext token already on the
   * row (the calendar API mints one up front so it can build the URL in the
   * same response) is kept and the hash and hint are DERIVED from it. Without
   * it - every non-root create - whatever the request carried is discarded
   * and a fresh token is minted. Either way a malformed token or a
   * caller-chosen hash is replaced: there is no path to a row whose hash
   * disagrees with its token, and no path for a request body to choose the
   * secret. A brand-new row never carries a grace-period hash.
   */
  public static applyTokenColumnsOnCreate(
    data: CalendarFeedTokenColumns,
    options: { trustSuppliedToken: boolean },
  ): MintedCalendarFeedToken {
    let minted: MintedCalendarFeedToken;

    if (
      options.trustSuppliedToken &&
      CalendarFeedToken.isValidShape(data.token)
    ) {
      minted = {
        token: data.token,
        tokenHash: CalendarFeedToken.hash(data.token),
        tokenHint: CalendarFeedToken.hint(data.token),
      };
    } else {
      minted = CalendarFeedToken.mintSet();
    }

    data.token = minted.token;
    data.tokenHash = minted.tokenHash;
    data.tokenHint = minted.tokenHint;
    data.rotatedAt = OneUptimeDate.getCurrentDate();
    data.previousTokenHash = undefined;
    data.previousTokenExpiresAt = undefined;

    return minted;
  }

  /**
   * The partial row a rotation writes. `previousTokenHash` /
   * `previousTokenExpiresAt` are null on a first mint, which the update path
   * has to be able to write; the model types them as optional strings/dates,
   * hence the cast at this one boundary.
   */
  public static toRotationUpdateData(
    rotation: CalendarFeedRotation,
  ): CalendarFeedRotationUpdateData {
    return {
      token: rotation.token,
      tokenHash: rotation.tokenHash,
      tokenHint: rotation.tokenHint,
      rotatedAt: rotation.rotatedAt,
      previousTokenHash: rotation.previousTokenHash as unknown as string,
      previousTokenExpiresAt:
        rotation.previousTokenExpiresAt as unknown as Date,
    };
  }

  /**
   * Constant-time comparison of two hashes, for callers that compare a
   * freshly computed digest against a stored one in memory rather than in a
   * WHERE clause. Length mismatch is answered false without leaking timing on
   * the content.
   */
  public static isHashEqual(a: string, b: string): boolean {
    /*
     * Plain Uint8Arrays rather than Buffers: the two are interchangeable at
     * runtime, but the App build's @types/node rejects Buffer where an
     * ArrayBufferView is expected (the same mismatch PasswordHash and
     * TwoFactorBackupCode trip over), and TextEncoder is global on every
     * supported Node.
     */
    const bytesA: Uint8Array = new TextEncoder().encode(a);
    const bytesB: Uint8Array = new TextEncoder().encode(b);

    if (bytesA.length !== bytesB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bytesA, bytesB);
  }
}
