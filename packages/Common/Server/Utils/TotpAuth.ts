import Email from "../../Types/Email";
import * as OTPAuth from "otpauth";
import CaptureSpan from "./Telemetry/CaptureSpan";

/**
 * The HMAC algorithm every new enrolment is issued with.
 *
 * RFC 6238 fixes SHA1 as the default and every authenticator implements it.
 * The `algorithm` parameter in an otpauth:// URI is, in practice, advisory:
 * Google Authenticator and Microsoft Authenticator parse the URI, ignore the
 * parameter, and compute SHA1 anyway. A server that issues `algorithm=SHA256`
 * therefore hands those apps a QR code they will silently mis-implement — the
 * app shows a confident six digits, the server computes a completely different
 * six digits, and enrolment can never succeed no matter how many codes the
 * user tries. That is the failure this constant exists to prevent.
 *
 * SHA1 is not a weakness here. HMAC-SHA1 is unaffected by the collision
 * attacks that retired SHA1 for signatures (RFC 6234 / RFC 2104), and the
 * output is truncated to six digits over a 30 second window regardless — the
 * brute-force surface is the 10^6 code space, not the hash.
 */
export const DefaultTotpAlgorithm: string = "SHA1";

/**
 * Algorithms a submitted token is checked against, in order.
 *
 * OneUptime issued `SHA256` enrolments before this was understood. Those
 * secrets are still in the database and still work in the minority of apps
 * that do honour the parameter (1Password, Bitwarden, Aegis, FreeOTP), so
 * dropping SHA256 from verification would lock those accounts out of their
 * own logins.
 *
 * The cost is exactly one bit: two algorithms across the validation window
 * means twice as many six-digit strings are accepted at any instant. Against
 * a 10^6 code space that is still a vanishing fraction, and the tests pin the
 * bound so it cannot quietly grow.
 *
 * Retiring SHA256 needs more than time passing. Nothing on the row records
 * which algorithm the user's app actually computes, so "no legacy rows remain"
 * is not a question the database can answer today — removing it means either
 * storing the algorithm that verified, or accepting that some long-dormant
 * account re-enrols instead of logging in.
 */
export const SupportedTotpAlgorithms: Array<string> = ["SHA1", "SHA256"];

/**
 * Number of 30 second steps either side of now that a token is accepted for.
 *
 * Three steps is +/- 90 seconds, which absorbs ordinary phone/server clock
 * drift and the user typing the last digit as the code rolls over.
 */
export const TotpValidationWindow: number = 3;

/**
 * Number of digits in a token, and the length of the time step in seconds.
 * Both are the values Google Authenticator assumes, and — like `algorithm` —
 * both are parameters it ignores when told anything else.
 */
export const TotpDigits: number = 6;
export const TotpPeriodInSeconds: number = 30;

/**
 * Utility class for handling TOTP authentication.
 */
export default class TotpAuth {
  /**
   * Generates a random secret key for two-factor authentication.
   * @returns The generated secret key.
   */
  @CaptureSpan()
  public static generateSecret(): string {
    return new OTPAuth.Secret().base32;
  }

  @CaptureSpan()
  public static getLabel(data: { email: Email }): string {
    return data.email.toString();
  }

  @CaptureSpan()
  public static getTotp(data: {
    secret: string;
    email: Email;
    algorithm?: string | undefined;
  }): OTPAuth.TOTP {
    const totp: OTPAuth.TOTP = new OTPAuth.TOTP({
      // Provider or service the account is associated with.
      issuer: "OneUptime",
      // Account identifier.
      label: this.getLabel({
        email: data.email,
      }),
      // Algorithm used for the HMAC function.
      algorithm: data.algorithm || DefaultTotpAlgorithm,
      // Length of the generated tokens.
      digits: TotpDigits,
      // Interval of time for which a token is valid, in seconds.
      period: TotpPeriodInSeconds,
      // Arbitrary key encoded in Base32 or OTPAuth.Secret instance.
      secret: data.secret,
    });

    return totp;
  }

  /**
   * Strips the formatting authenticator apps add for readability.
   *
   * Google Authenticator renders a code as "123 456" and both the iOS and
   * Android clipboards keep that space when the user copies it. Rejecting the
   * paste is a self-inflicted "Invalid code" for a user who supplied exactly
   * the right secret material, so the separators are removed before the token
   * is compared. Anything that is not a digit is dropped, which also covers
   * the hyphen some apps use and stray whitespace from a trimmed paste.
   *
   * @param token - The raw token as submitted.
   * @returns The token reduced to its digits.
   */
  @CaptureSpan()
  public static normalizeToken(token: string): string {
    /*
     * The token arrives straight off a JSON body, so it is only a string
     * because the client chose to send one. A number or an object here must
     * fail verification, not throw out of `.replace` and surface as a 500.
     */
    if (typeof token !== "string" || !token) {
      return "";
    }

    return token.replace(/\D/g, "");
  }

  /**
   * Verifies if a given token matches the provided secret key.
   * @param data - The data object containing the secret key and token.
   * @returns A boolean indicating whether the token is valid or not.
   */
  @CaptureSpan()
  public static verifyToken(data: {
    secret: string;
    token: string;
    email: Email;
  }): boolean {
    const { secret, email } = data;

    if (!secret) {
      return false;
    }

    const token: string = this.normalizeToken(data.token);

    /*
     * otpauth compares the submitted string against the codes it generates,
     * so a token of the wrong length can never match — but it would still be
     * run through one HMAC per algorithm per window step first. Reject it up
     * front instead.
     */
    if (token.length !== TotpDigits) {
      return false;
    }

    for (const algorithm of SupportedTotpAlgorithms) {
      let totp: OTPAuth.TOTP;

      try {
        totp = this.getTotp({ secret, email, algorithm });
      } catch {
        /*
         * A secret that is not valid base32 throws in the OTPAuth.Secret
         * constructor. That is a corrupt row, not a wrong code, and it fails
         * identically for every algorithm — so stop rather than repeat it.
         */
        return false;
      }

      const delta: number | null = totp.validate({
        token,
        window: TotpValidationWindow,
      });

      if (delta !== null) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates a URI for the given secret key and user email, which can be used to set up two-factor authentication.
   * @param data - The data object containing the secret key and user email.
   * @returns The generated URI for setting up two-factor authentication.
   */
  @CaptureSpan()
  public static generateUri(data: {
    secret: string;
    userEmail: Email;
  }): string {
    const { secret, userEmail } = data;

    const totp: OTPAuth.TOTP = this.getTotp({
      secret,
      email: userEmail,
      algorithm: DefaultTotpAlgorithm,
    });

    return totp.toString();
  }
}
