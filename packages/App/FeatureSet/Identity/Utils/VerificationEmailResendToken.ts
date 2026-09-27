import crypto from "crypto";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";

/*
 * The credential a freshly signed-up browser holds so that it can ask for
 * another verification email without signing in.
 *
 * WHY A CREDENTIAL AT ALL
 *
 * A hosted signup ends on "check your inbox" with no session (see /signup in
 * Authentication.ts), so the page has nothing that proves who it is. The
 * obvious alternative -- "type your address and we will mail it again" -- is
 * the button login() deliberately stopped being: anyone who knew an address
 * could make the owner's inbox fill up, and the reply would say whether the
 * account existed and was unverified. This token is instead handed only to
 * the request that just created the account, so the only person who can press
 * the button is the one who solved the signup captcha for it.
 *
 * WHAT IT CARRIES, AND WHY THAT IS SAFE TO HAND OUT
 *
 * The id of the account the holder has just created and the address they
 * typed into the form, both of which they already know, plus when it was
 * issued and when it expires. Nothing in it is a secret and nothing in it
 * proves the mailbox: it does not verify anything, it only asks for the
 * verification mail to be sent again -- to the address STORED on the account,
 * never to one taken from the request -- and the route refuses it unless that
 * stored address still equals the one it was minted for.
 *
 * WHY IT IS NOT A JWT
 *
 * JSONWebToken.decode accepts any JWT signed with EncryptionSecret that carries
 * a valid `email` as a full user session. A resend token minted as such a JWT
 * would therefore be a session for an unverified account -- exactly what signup
 * refuses to issue. So this is a different format ("v1.<payload>.<signature>",
 * which no JWT parser accepts) signed with a different key: an HMAC key derived
 * from EncryptionSecret under a label used for nothing else, so a signature
 * made here verifies nowhere else and no signature made elsewhere verifies
 * here.
 *
 * ON AN INSECURE EncryptionSecret
 *
 * Deliberately NOT gated on IsEncryptionSecretInsecure. With a secret that is
 * public in the repository an attacker can already forge a full-session JWT for
 * any address, which is a far better prize than a forged resend token -- and a
 * forged resend token still only mails the stored address of an account whose
 * stored address it names, under the same per-account caps as a genuine one.
 * Disabling the feature would add no protection and would hide it from exactly
 * the environments (development, the end-to-end stack) that run with the
 * placeholder and need to exercise it.
 */

export const VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS: number =
  24 * 60 * 60;

export interface VerificationEmailResendTokenClaims {
  userId: ObjectID;
  email: Email;
  issuedAt: Date;
}

const TOKEN_VERSION_PREFIX: string = "v1";

/*
 * The label the signing key is derived under. Changing it invalidates every
 * outstanding token, which is the intended way to rotate them.
 */
const KEY_DERIVATION_LABEL: string =
  "oneuptime:identity:verification-email-resend-token:v1";

/*
 * Bounds applied before any cryptography runs, so an oversized or oddly shaped
 * body costs a regex test rather than an HMAC and a JSON parse. 900 base64url
 * characters is ~675 bytes of JSON: a UUID, two timestamps and an address far
 * longer than any mailbox anyone uses.
 */
const MAX_TOKEN_LENGTH: number = 1024;
const TOKEN_PATTERN: RegExp = /^v1\.[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{43}$/;

/*
 * How far in the future an issuance time may be. A little slack for clock
 * disagreement between the pods behind one hostname; beyond that the token
 * was not minted by an honest clock and is refused.
 */
const MAX_ISSUED_AT_CLOCK_SKEW_IN_MS: number = 5 * 60 * 1000;

export default class VerificationEmailResendToken {
  /*
   * null when the result would not verify (e.g. an address so long the token
   * breaks the length cap). The caller then simply offers no resend button,
   * and signing in remains the way to get a new link.
   */
  public static generate(data: {
    userId: ObjectID;
    email: Email;
    now?: Date | undefined;
  }): string | null {
    try {
      const now: Date = data.now || new Date();
      const issuedAtMs: number = now.getTime();
      const expiresAtMs: number =
        issuedAtMs + VERIFICATION_EMAIL_RESEND_TOKEN_EXPIRY_IN_SECONDS * 1000;

      const payload: string = JSON.stringify({
        v: 1,
        u: data.userId.toString(),
        e: data.email.toString().toLowerCase(),
        i: issuedAtMs,
        x: expiresAtMs,
      });

      const payloadB64: string = Buffer.from(payload, "utf8").toString(
        "base64url",
      );

      const token: string = `${TOKEN_VERSION_PREFIX}.${payloadB64}.${VerificationEmailResendToken.sign(payloadB64)}`;

      /*
       * Round-tripped through verify() so that generate can never hand out a
       * token the route would then refuse -- an invalid id, an address that
       * does not parse, a payload past the length cap.
       */
      return VerificationEmailResendToken.verify(token, now) ? token : null;
    } catch {
      /*
       * No resend token is a supported outcome (the page falls back to
       * "sign in to get a new link"); failing the signup that has already
       * created the account over it is not.
       */
      return null;
    }
  }

  // NEVER throws: anything that is not a valid, current token is null.
  public static verify(
    token: unknown,
    now?: Date | undefined,
  ): VerificationEmailResendTokenClaims | null {
    try {
      if (typeof token !== "string") {
        return null;
      }

      if (token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
        return null;
      }

      const parts: Array<string> = token.split(".");

      if (parts.length !== 3) {
        return null;
      }

      const payloadB64: string = parts[1] || "";
      const suppliedSignature: string = parts[2] || "";
      const expectedSignature: string =
        VerificationEmailResendToken.sign(payloadB64);

      const suppliedBuffer: Buffer = Buffer.from(suppliedSignature, "utf8");
      const expectedBuffer: Buffer = Buffer.from(expectedSignature, "utf8");

      /*
       * timingSafeEqual throws on unequal lengths, and the pattern above has
       * already pinned the supplied one to 43 characters, so this only
       * returns early on input that was never going to match.
       */
      if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
      ) {
        return null;
      }

      let claims: unknown = null;

      try {
        claims = JSON.parse(
          Buffer.from(payloadB64, "base64url").toString("utf8"),
        );
      } catch {
        // A correctly signed payload always parses; this one did not.
        return null;
      }

      if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
        return null;
      }

      const version: unknown = (claims as Record<string, unknown>)["v"];
      const userId: unknown = (claims as Record<string, unknown>)["u"];
      const email: unknown = (claims as Record<string, unknown>)["e"];
      const issuedAtMs: unknown = (claims as Record<string, unknown>)["i"];
      const expiresAtMs: unknown = (claims as Record<string, unknown>)["x"];

      if (version !== 1) {
        return null;
      }

      if (typeof userId !== "string" || !ObjectID.isValidUUID(userId)) {
        return null;
      }

      /*
       * Email.isValid is an unanchored match, so on its own it would accept
       * any string containing an address. That is acceptable only because the
       * payload is signed: this string is one generate() wrote.
       */
      if (typeof email !== "string" || !Email.isValid(email)) {
        return null;
      }

      if (
        typeof issuedAtMs !== "number" ||
        typeof expiresAtMs !== "number" ||
        !Number.isSafeInteger(issuedAtMs) ||
        !Number.isSafeInteger(expiresAtMs)
      ) {
        return null;
      }

      const nowMs: number = (now || new Date()).getTime();

      if (!(issuedAtMs <= nowMs + MAX_ISSUED_AT_CLOCK_SKEW_IN_MS)) {
        return null;
      }

      if (!(nowMs < expiresAtMs)) {
        return null;
      }

      return {
        userId: new ObjectID(userId),
        email: new Email(email),
        issuedAt: new Date(issuedAtMs),
      };
    } catch {
      /*
       * Every failure above is already a null; this is the backstop that
       * makes "never throws" true of anything not anticipated, because the
       * route treats a throw and a forgery very differently.
       */
      return null;
    }
  }

  /*
   * The signing key is derived per call rather than cached, so a process that
   * has its secret swapped under it (tests, above all) never signs with a
   * stale one. It is one extra HMAC over a short string.
   */
  private static sign(payloadB64: string): string {
    const key: Buffer = crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(KEY_DERIVATION_LABEL)
      .digest();

    return crypto
      .createHmac("sha256", key)
      .update(`${TOKEN_VERSION_PREFIX}.${payloadB64}`)
      .digest("base64url");
  }
}
