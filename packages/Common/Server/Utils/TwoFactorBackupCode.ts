import { EncryptionSecret } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "./Telemetry/CaptureSpan";
import crypto from "crypto";

/*
 * Single-use recovery codes for an account whose second factor is gone --
 * the phone that held the authenticator app, or the security key that is now
 * in a taxi somewhere.
 *
 * WHY THIS IS SERVER-ONLY
 *
 * Nothing in this file falls back to Math.random. Common/Utils/UUID does, on
 * purpose, because it is bundled into the dashboard and has to keep producing
 * well-formed ids in a browser with no Web Crypto -- which is exactly why
 * ObjectID.generate() must never mint a code here. A backup code is a
 * password-equivalent credential; if the platform cannot produce secure
 * randomness, generation must throw rather than quietly emit something
 * predictable. Common/Server/Utils/VerificationCode.ts makes the same call for
 * the same reason.
 *
 * THE CODE SPACE
 *
 * Ten characters drawn uniformly from a 32 symbol alphabet is 2^50 codes, and
 * a user holds ten of them at once -- so a blind guess lands with probability
 * ~10/2^50, about one in 10^14. That is far beyond anything the rate limiter
 * needs to defend, which matters because it settles the design question a TOTP
 * code cannot settle: the six digit space is small enough that the limiter IS
 * the control, whereas here the code itself is.
 *
 * THE HASH
 *
 * Codes are stored as HMAC-SHA256 keyed by the instance's EncryptionSecret,
 * never in the clear, and the fast keyed-digest lane is the RIGHT one here
 * rather than scrypt. scrypt exists to make guessing a low-entropy,
 * human-chosen secret expensive; a code minted above has no low-entropy
 * structure to guess, so the cost would buy nothing and would be paid on every
 * verification. Keying with the EncryptionSecret is what a bare SHA-256 would
 * miss: it lives in configuration rather than in Postgres, so a database dump
 * on its own cannot be run through a dictionary of every possible code.
 *
 * The digest is deterministic given (userId, code), which is deliberate and is
 * what makes single-use consumption a single conditional UPDATE rather than a
 * read of every one of the user's rows followed by a comparison of each. A
 * per-row salt would forfeit that for no gain -- see the note on domain
 * separation below for the property it would have been bought for, which the
 * userId already provides.
 */

/**
 * Crockford's Base32 alphabet: the digits and the uppercase letters, minus
 * I, L, O and U.
 *
 * These codes get read off a screen and typed back in months later, possibly
 * from a piece of paper in a drawer, so the alphabet is chosen for the eye
 * rather than for density. I/1, L/1 and O/0 are the pairs people transcribe
 * wrongly; U is dropped by Crockford so that no code can spell an obscenity
 * at a user who did nothing to deserve one.
 *
 * Exactly 32 symbols, so each character carries a clean five bits and the
 * entropy arithmetic in the header comment is exact rather than approximate.
 */
export const BackupCodeAlphabet: string = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters per code. Ten symbols over a 32 symbol alphabet is 2^50. */
export const BackupCodeLength: number = 10;

/**
 * How many codes a user is issued at once.
 *
 * Ten is enough that losing a phone does not become an emergency after the
 * second sign-in, and small enough that the printed list is one short block a
 * person will actually keep.
 */
export const BackupCodeSetSize: number = 10;

/** Characters per group in the displayed form, e.g. `AB3D5-9XZQ2`. */
const DISPLAY_GROUP_LENGTH: number = 5;

/*
 * Prefixed into every digest so a stored hash is bound to the scheme that
 * produced it. If the construction below ever has to change, old rows keep
 * verifying under the version they were written with instead of silently
 * failing to match and locking a user out of their own recovery codes.
 */
const HASH_SCHEME_VERSION: string = "v1";

/*
 * Characters a person plausibly types in place of a symbol that is not in the
 * alphabet. Applied before the strip below, so `O` becomes `0` rather than
 * being deleted -- deleting it would shorten the code and guarantee a
 * mismatch, which is the confusing failure this map exists to avoid.
 */
const AMBIGUOUS_CHARACTER_MAP: Record<string, string> = {
  I: "1",
  L: "1",
  O: "0",
};

export default class TwoFactorBackupCode {
  /**
   * One code, drawn uniformly from the alphabet above.
   *
   * `crypto.randomInt` per character rather than `randomBytes(n) % 32`. The
   * modulo version happens to be uniform for this alphabet only because 32
   * divides 256, and it stops being uniform the moment somebody edits the
   * alphabet -- silently, with no test that would notice. `randomInt` rejects
   * out-of-range draws internally for whatever bound it is given, so the
   * uniformity does not depend on a coincidence nobody wrote down.
   */
  @CaptureSpan()
  public static generateCode(): string {
    let code: string = "";

    for (let index: number = 0; index < BackupCodeLength; index++) {
      code += BackupCodeAlphabet.charAt(
        crypto.randomInt(0, BackupCodeAlphabet.length),
      );
    }

    return code;
  }

  /**
   * A full set of distinct codes.
   *
   * Duplicates are not a security problem -- at 2^50 the birthday odds across
   * ten draws are around 4e-14 -- but a duplicate WOULD be a correctness
   * problem downstream: two rows sharing a digest means consuming one leaves a
   * second, identical, still-valid code behind, so a "single-use" code would
   * work twice. Cheaper to rule out here than to reason about there.
   */
  @CaptureSpan()
  public static generateCodeSet(
    count: number = BackupCodeSetSize,
  ): Array<string> {
    const codes: Set<string> = new Set<string>();

    while (codes.size < count) {
      codes.add(TwoFactorBackupCode.generateCode());
    }

    return Array.from(codes);
  }

  /**
   * The form shown to the user: one hyphen in the middle, for the same reason
   * the alphabet drops ambiguous letters -- a ten character run is hard to
   * read back without losing your place.
   *
   * Purely cosmetic. `normalizeCode` strips the hyphen straight back out, so
   * a user may type the code with it, without it, or with the spaces their
   * password manager pasted in.
   */
  @CaptureSpan()
  public static formatForDisplay(code: string): string {
    const groups: Array<string> = [];

    for (
      let index: number = 0;
      index < code.length;
      index += DISPLAY_GROUP_LENGTH
    ) {
      groups.push(code.substring(index, index + DISPLAY_GROUP_LENGTH));
    }

    return groups.join("-");
  }

  /**
   * Reduce whatever the user typed to the canonical form the digest is
   * computed over.
   *
   * Everything here is about not rejecting somebody who supplied exactly the
   * right secret material: the display hyphen, the spaces a clipboard adds,
   * lowercase from a phone keyboard, and the three transcription confusions
   * the alphabet was chosen to make survivable. Anything still outside the
   * alphabet after that is dropped rather than rejected -- this is a
   * canonicaliser, not a validator; the digest comparison is what decides
   * whether a code is real.
   *
   * @param rawCode - The code exactly as submitted.
   * @returns The code reduced to alphabet symbols, uppercase.
   */
  @CaptureSpan()
  public static normalizeCode(rawCode: string): string {
    /*
     * The code arrives straight off a JSON body, so it is only a string
     * because the client chose to send one. A number or an object here must
     * fail verification, not throw out of `.toUpperCase` and surface as a 500.
     */
    if (typeof rawCode !== "string" || !rawCode) {
      return "";
    }

    let normalized: string = "";

    for (const character of rawCode.toUpperCase()) {
      const mapped: string = AMBIGUOUS_CHARACTER_MAP[character] || character;

      if (BackupCodeAlphabet.includes(mapped)) {
        normalized += mapped;
      }
    }

    return normalized;
  }

  /**
   * The digest stored for one of `userId`'s codes.
   *
   * Domain separated by the owning user, which is what stops one precomputed
   * table from inverting every account's codes at once and stops two users who
   * happen to be issued the same code from being visibly linked by a matching
   * row. The user id is known at verification time -- the password has already
   * been accepted by then -- so binding to it costs nothing.
   *
   * Both parts are LENGTH-PREFIXED into the message rather than merely
   * concatenated, so no pair of (userId, code) values can be rearranged into
   * the same byte string as another pair. Concatenation alone is a real
   * ambiguity, not a theoretical one: without prefixes, ("ab", "cd") and
   * ("abc", "d") hash identically.
   */
  @CaptureSpan()
  public static hashCode(data: { code: string; userId: ObjectID }): string {
    const message: string = [
      HASH_SCHEME_VERSION,
      data.userId.toString(),
      TwoFactorBackupCode.normalizeCode(data.code),
    ]
      .map((part: string) => {
        return `${part.length}:${part}`;
      })
      .join("");

    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(message)
      .digest("hex");
  }

  /**
   * Compare two digests without leaking, through timing, how many leading
   * characters matched.
   *
   * The consume path compares digests in Postgres rather than here, so this is
   * for callers that already hold both -- but it exists so that nobody writing
   * one reaches for `===` and hands an attacker a way to recover a stored hash
   * one character at a time.
   *
   * Lengths are compared first because `crypto.timingSafeEqual` THROWS on a
   * length mismatch. Digests here are always 64 hex characters, so an early
   * exit only happens on malformed input, where the length is not the secret.
   */
  @CaptureSpan()
  public static isHashEqual(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(a, "utf8"),
      Buffer.from(b, "utf8"),
    );
  }
}
