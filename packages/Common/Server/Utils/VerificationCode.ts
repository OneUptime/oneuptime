import { EncryptionSecret } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import crypto from "crypto";

/*
 * The cryptography behind notification-channel ownership checks: the codes
 * mailed/texted/read out to a user to prove they hold the address or number
 * they just added.
 *
 * This is deliberately server-only. Common/Types/Text is bundled into the
 * dashboard and therefore has to tolerate a runtime with no CSPRNG; a code
 * minted here has no such excuse, so nothing in this file falls back to
 * Math.random. If the platform cannot produce secure randomness, generation
 * throws and the channel simply cannot be added.
 *
 * WHY THE STORED VALUE IS A DIGEST
 *
 * A six-digit code is only a secret for as long as it is in flight. Storing
 * the plaintext puts a live account-takeover token in a database column, a
 * backup, a replica and every log line that ever dumps the row - and the
 * column sits on a table (UserEmail and friends) whose entire access-control
 * design exists because reading somebody else's row IS the attack. Keeping a
 * keyed digest means a database dump alone yields nothing: the attacker also
 * needs the deployment's EncryptionSecret, and even holding both, recovering
 * the code means re-running the HMAC over the code space per row, because...
 *
 * WHY THE ROW ID IS IN THE MESSAGE
 *
 * ...the digest is domain-separated by the row it belongs to. Without that,
 * one HMAC table of all 10^6 codes inverts every row in the table at once,
 * and two rows that happened to draw the same code would be visibly equal.
 * With it, the same code on two rows produces two unrelated digests.
 *
 * A fast hash is right here, unlike a password: the input is a value the
 * server minted at random, so there is nothing to guess offline that the
 * attempt counter is not already bounding online. The scheme version prefix
 * is there so a future change of construction can be told apart from this one
 * rather than silently invalidating or, worse, colliding with it.
 */

const HASH_SCHEME_VERSION: string = "v1";

/*
 * Six digits, matching what the notification templates and the dashboard's
 * code input already expect. The code space is small on purpose - it has to
 * be readable off a phone screen - which is exactly why every control around
 * it (expiry, attempt counter, lockout, rate limit) is load-bearing rather
 * than defence in depth.
 */
export const VERIFICATION_CODE_LENGTH: number = 6;

export default class VerificationCode {
  /*
   * A fresh code, drawn uniformly from the whole code space.
   *
   * crypto.randomInt does the rejection sampling itself, so there is no modulo
   * bias here and no need to hand-roll one. Leading zeros are kept: "000123"
   * is a perfectly good code, and dropping them would quietly shrink the
   * space by 10%.
   */
  public static generate(length: number = VERIFICATION_CODE_LENGTH): string {
    let code: string = "";

    for (let i: number = 0; i < length; i++) {
      code += crypto.randomInt(0, 10).toString();
    }

    return code;
  }

  /*
   * The digest to store for `code` on the row identified by `channelId`.
   *
   * Both inputs are length-prefixed into the message rather than merely
   * concatenated, so no pair of (id, code) values can be rearranged into the
   * same byte string as another pair.
   */
  public static hashCode(data: { code: string; channelId: ObjectID }): string {
    const message: string = [
      HASH_SCHEME_VERSION,
      data.channelId.toString(),
      data.code,
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

  /*
   * Compare two digests without leaking, through timing, how many leading
   * bytes matched.
   *
   * `===` on strings short-circuits at the first differing character, and the
   * attacker here controls the plaintext that produces one side of the
   * comparison. That is a much weaker oracle than it is for a password check -
   * they would be recovering a digest of a value that expires in minutes - but
   * a constant-time compare costs nothing and removes the question.
   *
   * Lengths are compared first. Both digests are always 64 hex characters, so
   * an early return only happens on malformed input, where the length is not
   * the secret.
   */
  public static isHashEqual(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(a, "utf8"),
      Buffer.from(b, "utf8"),
    );
  }

  /*
   * A digest that no code can ever produce, for burning the outstanding
   * challenge.
   *
   * Used when a row is locked out or successfully verified. The column is NOT
   * NULL, so "there is no live code" cannot be expressed as null; it is
   * expressed as a digest drawn at random from a 256-bit space, which the
   * 10^6 possible codes cannot hit. Rotating rather than leaving the old
   * digest in place matters: it means a lockout is not merely a pause an
   * attacker can wait out with the same target still valid behind it.
   */
  public static generateUnusableHash(): string {
    return crypto.randomBytes(32).toString("hex");
  }
}
